from __future__ import annotations

import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Protocol

import structlog
from engram_sdk.errors import EngramError as SdkEngramError

from worker.config import WorkerSettings
from worker.engram.engram_brain import _map_sdk_error
from worker.engram.errors import BrainError, ConflictError, UnauthorizedError
from worker.engram.factory import create_org_engram
from worker.engram.user_id import persona_engine_user_id

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class OrgMember:
    """People row for this Google email.

    ``password`` is set only when ``auth.login`` accepted it. Finding the
    ``user_id`` (including via members.list after a 409) is not holding the
    credential. ``password is None`` is the degrade-to-shared-only signal.
    """

    user_id: str
    password: str | None


class OrgRoster(Protocol):
    def add_member(
        self,
        email: str,
        *,
        name: str,
        role: str,
        password: str,
    ) -> str: ...

    def list_members(self) -> list[tuple[str, str]]: ...

    def login(self, email: str, password: str) -> None: ...

    def close(self) -> None: ...


def _login_token(session: Any) -> str | None:
    if isinstance(session, dict):
        token = session.get("token")
    else:
        token = getattr(session, "token", None)
    if isinstance(token, str) and token:
        return token
    return None


class SdkOrgRoster:
    def __init__(self, client: Any) -> None:
        self._client = client

    def add_member(
        self,
        email: str,
        *,
        name: str,
        role: str,
        password: str,
    ) -> str:
        try:
            member = self._client.members.add(
                email,
                name=name,
                role=role,
                password=password,
            )
        except SdkEngramError as exc:
            raise _map_sdk_error(exc) from exc
        return persona_engine_user_id(str(member.user_id))

    def list_members(self) -> list[tuple[str, str]]:
        try:
            rows = self._client.members.list()
        except SdkEngramError as exc:
            raise _map_sdk_error(exc) from exc
        found: list[tuple[str, str]] = []
        for row in rows:
            email = str(getattr(row, "email", "") or "")
            user_id = persona_engine_user_id(str(getattr(row, "user_id", "") or ""))
            if email and user_id:
                found.append((email, user_id))
        return found

    def login(self, email: str, password: str) -> None:
        try:
            session = self._client.auth.login(email, password)
        except SdkEngramError as exc:
            raise _map_sdk_error(exc) from exc
        # Token is proof only. It is not returned or stored.
        if _login_token(session) is None:
            raise UnauthorizedError("auth.login returned no token")

    def close(self) -> None:
        closer = getattr(self._client, "close", None)
        if closer is not None:
            closer()


@contextmanager
def open_org_roster(settings: WorkerSettings) -> Iterator[SdkOrgRoster]:
    client = create_org_engram(settings)
    roster = SdkOrgRoster(client)
    try:
        yield roster
    finally:
        roster.close()


def skip_org_join(settings: WorkerSettings, email: str) -> bool:
    prefix = settings.engram_org_join_skip_email_prefix.lower()
    domain = settings.engram_org_join_skip_email_domain.lower()
    lowered = email.strip().lower()
    if not prefix or not domain or "@" not in lowered:
        return False
    local, _, host = lowered.partition("@")
    return local.startswith(prefix) and host == domain


def _member_id_for_email(roster: OrgRoster, email: str) -> str | None:
    wanted = email.strip().lower()
    for listed_email, user_id in roster.list_members():
        if listed_email.strip().lower() == wanted:
            return user_id
    return None


def _password_accepted(roster: OrgRoster, email: str, password: str) -> bool:
    try:
        roster.login(email, password)
    except BrainError:
        return False
    return True


def ensure_org_member(
    roster: OrgRoster,
    settings: WorkerSettings,
    *,
    email: str,
) -> OrgMember:
    """Join this Google email to Engram People and keep a credential if we can.

    Always generates a password for ``members.add``. ``auth.login`` is the
    honest check that we hold it; that check runs here at provision time so a
    stored secret is one we have already proven, not a value that might fail
    later. A 409 or a login miss stores the id with no password — the member
    keeps talking, shared-only. Finding the id is not holding the credential.
    """
    if skip_org_join(settings, email):
        raise BrainError(settings.log_engram_join_skipped)
    role = settings.engram_org_member_role
    password = secrets.token_urlsafe(settings.engram_org_member_password_nbytes)
    try:
        user_id = roster.add_member(email, name=email, role=role, password=password)
    except ConflictError:
        found = _member_id_for_email(roster, email)
        if found:
            log.warning(
                settings.log_engram_credential_unavailable,
                reason="already_a_member",
                engram_user_id=found,
            )
            return OrgMember(user_id=found, password=None)
        raise
    if _password_accepted(roster, email, password):
        return OrgMember(user_id=user_id, password=password)
    log.warning(
        settings.log_engram_credential_unavailable,
        reason="password_not_accepted",
        engram_user_id=user_id,
    )
    return OrgMember(user_id=user_id, password=None)
