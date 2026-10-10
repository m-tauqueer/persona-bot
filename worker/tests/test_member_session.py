from __future__ import annotations

import base64
import json
import os
import threading
from uuid import uuid4

import pytest

from worker.config import WorkerSettings
from worker.engram.engram_brain import EngramBrain
from worker.engram.errors import UnauthorizedError
from worker.engram.factory import create_engram, create_member_engram
from worker.engram.registry import BrainRegistry
from worker.engram.session import (
    MemberSessionCache,
    call_as_member,
    member_brain,
)


class _Clock:
    def __init__(self, now: float = 1_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class _Login:
    def __init__(self, tokens: list[tuple[str, int]] | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self._tokens = list(tokens or [("tok-1", 43200)])
        self.error: Exception | None = None
        self.gate = threading.Event()
        self.entered = threading.Event()
        self.block = False

    def __call__(self, email: str, password: str) -> dict[str, object]:
        if self.block:
            self.entered.set()
            self.gate.wait(1)
        self.calls.append((email, password))
        if self.error is not None:
            raise self.error
        token, expires_in = self._tokens.pop(0)
        return {"token": token, "expires_in": expires_in}


class _FakeClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        self.api_key = kwargs.get("api_key")
        self.closed = False

    def close(self) -> None:
        self.closed = True


def _configured(settings: WorkerSettings) -> WorkerSettings:
    kwargs = settings.model_dump()
    kwargs["engram_org_id"] = "org-1"
    kwargs["engram_base_url"] = "https://engram.example"
    kwargs["engram_api_key"] = "egm_org"
    return WorkerSettings(_env_file=None, **kwargs)


def _cache(
    settings: WorkerSettings,
    login: _Login,
    clock: _Clock | None = None,
) -> MemberSessionCache:
    return MemberSessionCache(settings, login=login, clock=clock or _Clock())


def test_null_secret_never_logs_in(settings: WorkerSettings) -> None:
    login = _Login()
    cache = _cache(settings, login)
    assert (
        cache.token(
            engram_user_id="member-1",
            email="a@example.com",
            password_provider=lambda: None,
        )
        is None
    )
    assert login.calls == []


def test_token_requires_password_provider_not_password(
    settings: WorkerSettings,
) -> None:
    login = _Login()
    cache = _cache(settings, login)
    with pytest.raises(TypeError):
        cache.token(  # type: ignore[call-arg]
            engram_user_id="member-1",
            email="a@example.com",
            password="secret",
        )
    assert login.calls == []


def test_mints_once_and_reuses_within_lifetime(settings: WorkerSettings) -> None:
    login = _Login(tokens=[("tok-1", 43200)])
    cache = _cache(settings, login)
    first = cache.token(
        engram_user_id="member-1",
        email="a@example.com",
        password_provider=lambda: "pw",
    )
    second = cache.token(
        engram_user_id="member-1",
        email="a@example.com",
        password_provider=lambda: "pw",
    )
    assert first == "tok-1"
    assert second == "tok-1"
    assert login.calls == [("a@example.com", "pw")]


def test_refresh_before_expiry_skew(settings: WorkerSettings) -> None:
    login = _Login(tokens=[("tok-1", 100), ("tok-2", 100)])
    clock = _Clock()
    loaded = settings.model_copy(
        update={"engram_member_token_refresh_skew_seconds": 20},
    )
    cache = MemberSessionCache(loaded, login=login, clock=clock)
    def _tok() -> str | None:
        return cache.token(
            engram_user_id="m",
            email="a@x",
            password_provider=lambda: "pw",
        )

    assert _tok() == "tok-1"
    clock.now += 81
    assert _tok() == "tok-2"
    assert len(login.calls) == 2


def test_login_failure_is_unauthenticated_not_org_key(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    monkeypatch.setattr("worker.engram.factory.EngramClient", _FakeClient)
    loaded = _configured(settings)
    login = _Login()
    login.error = UnauthorizedError("invalid email or password", status=401)
    cache = _cache(loaded, login)
    brains = BrainRegistry(loaded)
    try:
        brain = member_brain(
            cache,
            brains,
            engram_user_id="member-1",
            email="a@example.com",
            password_provider=lambda: "pw",
        )
        assert brain is None
        assert login.calls == [("a@example.com", "pw")]
    finally:
        brains.close()


def test_401_triggers_exactly_one_relogin(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    monkeypatch.setattr("worker.engram.factory.EngramClient", _FakeClient)
    loaded = _configured(settings)
    login = _Login(tokens=[("tok-1", 43200), ("tok-2", 43200)])
    cache = _cache(loaded, login)
    brains = BrainRegistry(loaded)
    attempts = {"n": 0}

    def op(_brain: EngramBrain) -> str:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise UnauthorizedError("expired", status=401)
        return "ok"

    try:
        result = call_as_member(
            cache,
            brains,
            engram_user_id="member-1",
            email="a@example.com",
            password_provider=lambda: "pw",
            op=op,
        )
        assert result == "ok"
        assert len(login.calls) == 2
        assert attempts["n"] == 2
    finally:
        brains.close()


def test_two_threads_on_cold_cache_mint_once(settings: WorkerSettings) -> None:
    login = _Login(tokens=[("tok-1", 43200)])
    login.block = True
    cache = _cache(settings, login)
    results: list[str | None] = []

    def run() -> None:
        results.append(
            cache.token(
                engram_user_id="member-1",
                email="a@example.com",
                password_provider=lambda: "pw",
            ),
        )

    first = threading.Thread(target=run)
    second = threading.Thread(target=run)
    first.start()
    assert login.entered.wait(1)
    second.start()
    login.gate.set()
    first.join(1)
    second.join(1)
    assert sorted(results) == ["tok-1", "tok-1"]
    assert login.calls == [("a@example.com", "pw")]


def test_registry_replaces_brain_when_token_changes(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    monkeypatch.setattr("worker.engram.factory.EngramClient", _FakeClient)
    loaded = _configured(settings)
    registry = BrainRegistry(loaded)
    try:
        first = registry.get("member-1", api_key="tok-1")
        again = registry.get("member-1", api_key="tok-1")
        assert again is first
        replaced = registry.get("member-1", api_key="tok-2")
        assert replaced is not first
        assert first.uses_member_token("tok-1")
        assert replaced.uses_member_token("tok-2")
        assert first._client.closed is True  # type: ignore[attr-defined]
    finally:
        registry.close()


def test_create_member_engram_does_not_use_org_key(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, org: str, user: str, **kwargs: object) -> None:
            captured["org"] = org
            captured["user"] = user
            captured["api_key"] = kwargs.get("api_key")
            captured["max_retries"] = kwargs.get("max_retries")

        def close(self) -> None:
            return None

    loaded = _configured(settings)
    monkeypatch.setattr("worker.engram.factory.EngramClient", FakeClient)
    create_member_engram(loaded, "member-1", api_key="jwt-member")
    assert captured["api_key"] == "jwt-member"
    assert captured["max_retries"] == 0
    create_engram(loaded, "member-1")
    assert captured["api_key"] == "egm_org"


def test_create_member_engram_refuses_empty_token(
    settings: WorkerSettings,
) -> None:
    with pytest.raises(RuntimeError, match="session token"):
        create_member_engram(settings, "member-1", api_key="")


def _jwt_sub(token: str) -> str:
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(padded))
    return str(claims["sub"])


@pytest.mark.skipif(
    not os.environ.get("ENGRAM_LIVE_MEMBER_SESSION_TEST"),
    reason="set ENGRAM_LIVE_MEMBER_SESSION_TEST=1 to mint against live Engram",
)
def test_live_jwt_sub_equals_member_id() -> None:
    from worker.config import load_settings
    from worker.engram.factory import create_org_engram
    from worker.engram.org_member import SdkOrgRoster

    settings = load_settings()
    if not settings.engram_api_key or not settings.engram_org_id:
        pytest.skip("Engram is not configured")
    email = f"cognora-probe-{uuid4().hex[:16]}@gmail.com"
    password = "probe-" + uuid4().hex
    client = create_org_engram(settings)
    roster = SdkOrgRoster(client)
    user_id = None
    try:
        user_id = roster.add_member(
            email,
            name=email,
            role=settings.engram_org_member_role,
            password_provider=lambda: password,
        )
        cache = MemberSessionCache(settings)
        token = cache.token(
            engram_user_id=user_id,
            email=email,
            password_provider=lambda: password,
        )
        assert token is not None
        assert _jwt_sub(token) == user_id
    finally:
        if user_id is not None:
            try:
                client.members.remove(user_id)
            except Exception:
                pass
        roster.close()


def test_warm_token_never_resolves_the_password_again(
    settings: WorkerSettings,
) -> None:
    """A live token must cost no database read on the reply path."""
    logins = {"n": 0}
    lookups = {"n": 0}

    def login(_email: str, _password: str) -> dict[str, object]:
        logins["n"] += 1
        return {"token": f"tok-{logins['n']}", "expires_in": 43200}

    def password_provider() -> str | None:
        lookups["n"] += 1
        return "pw"

    cache = MemberSessionCache(settings, login=login)
    for _ in range(5):
        assert (
            cache.token(
                engram_user_id="m",
                email="a@example.com",
                password_provider=password_provider,
            )
            == "tok-1"
        )
    assert logins["n"] == 1
    assert lookups["n"] == 1


def test_no_credential_short_circuits_before_login(
    settings: WorkerSettings,
) -> None:
    logins = {"n": 0}

    def login(_email: str, _password: str) -> dict[str, object]:
        logins["n"] += 1
        return {"token": "tok", "expires_in": 43200}

    cache = MemberSessionCache(settings, login=login)
    assert (
        cache.token(
            engram_user_id="m",
            email="a@example.com",
            password_provider=lambda: None,
        )
        is None
    )
    assert logins["n"] == 0
