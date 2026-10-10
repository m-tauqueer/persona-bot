"""In-memory member session tokens. Never persist, log, or trace them."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from engram_sdk.errors import EngramError as SdkEngramError

from worker.config import WorkerSettings
from worker.engram.engram_brain import EngramBrain, _map_sdk_error
from worker.engram.errors import BrainError, UnauthorizedError
from worker.engram.factory import create_org_engram
from worker.engram.registry import BrainRegistry
from worker.engram.user_id import persona_engine_user_id

LoginFn = Callable[[str, str], Any]
ClockFn = Callable[[], float]
# Resolving a member's password costs a database read and a decrypt. It is a
# callable so a warm token never pays for it — see `MemberSessionCache.token`.
PasswordFn = Callable[[], str | None]


@dataclass
class _Entry:
    token: str
    expires_at: float


def _login_fields(session: Any) -> tuple[str, int] | None:
    if isinstance(session, dict):
        token = session.get("token")
        expires_in = session.get("expires_in")
    else:
        token = getattr(session, "token", None)
        expires_in = getattr(session, "expires_in", None)
    if not isinstance(token, str) or not token:
        return None
    if isinstance(expires_in, bool) or not isinstance(expires_in, int | float):
        return None
    seconds = int(expires_in)
    if seconds <= 0:
        return None
    return token, seconds


class MemberSessionCache:
    """Per-member session JWT plus expiry. Tokens live in this process only.

    Chosen client strategy: resolve the token per request, then ask
    ``BrainRegistry.get(..., api_key=token)``. ``EngramClient`` captures
    ``api_key`` at construction, so a cached brain is replaced when the
    token changes. An expired JWT is never reused as a client credential.
    """

    def __init__(
        self,
        settings: WorkerSettings,
        *,
        login: LoginFn | None = None,
        clock: ClockFn | None = None,
    ) -> None:
        self._settings = settings
        self._login = login
        self._clock = clock or time.time
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, _Entry] = OrderedDict()
        # One lock per member. Minting is a network round trip, so a single
        # shared lock would stall every other member's turn behind one login.
        self._minting: dict[str, threading.Lock] = {}

    def _cached(self, key: str) -> str | None:
        skew = self._settings.engram_member_token_refresh_skew_seconds
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None and cached.expires_at - skew > self._clock():
                self._entries.move_to_end(key)
                return cached.token
        return None

    def _mint_lock(self, key: str) -> threading.Lock:
        with self._lock:
            lock = self._minting.get(key)
            if lock is None:
                lock = threading.Lock()
                self._minting[key] = lock
            return lock

    def token(
        self,
        *,
        engram_user_id: str,
        email: str,
        password_provider: PasswordFn,
        force_refresh: bool = False,
    ) -> str | None:
        key = persona_engine_user_id(engram_user_id)
        if not force_refresh:
            hit = self._cached(key)
            if hit is not None:
                return hit
        # Only a miss or a refresh pays for the password, so a member with a
        # live token costs no database read on the reply path.
        with self._mint_lock(key):
            if not force_refresh:
                hit = self._cached(key)
                if hit is not None:
                    return hit
            password = password_provider()
            if password is None:
                with self._lock:
                    self._entries.pop(key, None)
                return None
            session = self._mint(email, password)
            parsed = _login_fields(session) if session is not None else None
            with self._lock:
                if parsed is None:
                    self._entries.pop(key, None)
                    return None
                token, expires_in = parsed
                entry = _Entry(token=token, expires_at=self._clock() + expires_in)
                self._entries[key] = entry
                self._entries.move_to_end(key)
                while len(self._entries) > self._settings.engram_client_cache_size:
                    self._entries.popitem(last=False)
                return token

    def drop(self, engram_user_id: str) -> None:
        key = persona_engine_user_id(engram_user_id)
        with self._lock:
            self._entries.pop(key, None)
            self._minting.pop(key, None)

    def _mint(self, email: str, password: str) -> Any | None:
        try:
            if self._login is not None:
                return self._login(email, password)
            client = create_org_engram(self._settings)
            try:
                return client.auth.login(email, password)
            except SdkEngramError as exc:
                raise _map_sdk_error(exc) from exc
            finally:
                closer = getattr(client, "close", None)
                if closer is not None:
                    closer()
        except BrainError:
            return None


def member_brain(
    cache: MemberSessionCache,
    brains: BrainRegistry,
    *,
    engram_user_id: str,
    email: str,
    password_provider: PasswordFn,
) -> EngramBrain | None:
    """Build a member-token brain, or None. Never an org-key client as a member."""
    token = cache.token(
        engram_user_id=engram_user_id,
        email=email,
        password_provider=password_provider,
    )
    if token is None:
        return None
    return brains.get(engram_user_id, api_key=token)


def call_as_member[T](
    cache: MemberSessionCache,
    brains: BrainRegistry,
    *,
    engram_user_id: str,
    email: str,
    password_provider: PasswordFn,
    op: Callable[[EngramBrain], T],
) -> T | None:
    """Run ``op`` as the member. One re-login on 401, then unauthenticated.

    Returns None when we cannot authenticate. That is not an org-key brain.
    """
    brain = member_brain(
        cache,
        brains,
        engram_user_id=engram_user_id,
        email=email,
        password_provider=password_provider,
    )
    if brain is None:
        return None
    try:
        return op(brain)
    except UnauthorizedError:
        token = cache.token(
            engram_user_id=engram_user_id,
            email=email,
            password_provider=password_provider,
            force_refresh=True,
        )
        if token is None:
            brains.forget(engram_user_id)
            return None
        brains.forget(engram_user_id)
        brain = brains.get(engram_user_id, api_key=token)
        try:
            return op(brain)
        except UnauthorizedError:
            brains.forget(engram_user_id)
            cache.drop(engram_user_id)
            return None
