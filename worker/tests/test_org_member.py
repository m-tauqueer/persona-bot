from __future__ import annotations

from engram_sdk.errors import ForbiddenError as SdkForbiddenError
from engram_sdk.errors import UnauthorizedError as SdkUnauthorizedError

from worker.config import WorkerSettings
from worker.engram.errors import (
    BrainError,
    ConflictError,
    ForbiddenError,
    UnauthorizedError,
)
from worker.engram.org_member import (
    OrgMember,
    SdkOrgRoster,
    ensure_org_member,
    skip_org_join,
)


class FakeRoster:
    def __init__(
        self,
        *,
        user_id: str = "eng-1",
        add_error: Exception | None = None,
        listed: list[tuple[str, str]] | None = None,
        login_error: Exception | None = None,
        login_token: str | None = "tok",
    ) -> None:
        self.user_id = user_id
        self.add_error = add_error
        self.listed = listed or []
        self.login_error = login_error
        self.login_token = login_token
        self.passwords: list[str] = []
        self.logins: list[tuple[str, str]] = []
        self.closed = False

    def add_member(
        self,
        email: str,
        *,
        name: str,
        role: str,
        password: str,
    ) -> str:
        del email, name, role
        self.passwords.append(password)
        if self.add_error is not None:
            raise self.add_error
        return self.user_id

    def list_members(self) -> list[tuple[str, str]]:
        return list(self.listed)

    def login(self, email: str, password: str) -> None:
        self.logins.append((email, password))
        if self.login_error is not None:
            raise self.login_error
        if not self.login_token:
            raise UnauthorizedError("auth.login returned no token")

    def close(self) -> None:
        self.closed = True


def test_skip_probe_emails(settings: WorkerSettings) -> None:
    assert skip_org_join(settings, "probe-abc@example.test") is True
    assert skip_org_join(settings, "member@example.com") is False
    assert skip_org_join(settings, "probe-abc@gmail.com") is False


def test_ensure_new_member_keeps_password_when_login_accepts(
    settings: WorkerSettings,
) -> None:
    roster = FakeRoster(user_id="abc123")
    member = ensure_org_member(roster, settings, email="sam@example.com")
    assert member == OrgMember(user_id="abc123", password=roster.passwords[0])
    assert member.password
    assert roster.passwords[0]
    assert roster.logins == [("sam@example.com", member.password)]


def test_ensure_never_adds_with_empty_password(settings: WorkerSettings) -> None:
    roster = FakeRoster(user_id="new-id")
    ensure_org_member(roster, settings, email="new@example.com")
    assert roster.passwords
    assert all(password for password in roster.passwords)


def test_ensure_conflict_stores_id_without_password(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    warnings: list[tuple[str, dict[str, object]]] = []

    def _warn(event: str, **kwargs: object) -> None:
        warnings.append((event, kwargs))

    monkeypatch.setattr("worker.engram.org_member.log.warning", _warn)
    roster = FakeRoster(
        add_error=ConflictError("exists", status=409),
        listed=[("Sam@Example.com", "listed-id")],
    )
    member = ensure_org_member(roster, settings, email="sam@example.com")
    assert member == OrgMember(user_id="listed-id", password=None)
    assert roster.logins == []
    assert warnings == [
        (
            settings.log_engram_credential_unavailable,
            {"reason": "already_a_member", "engram_user_id": "listed-id"},
        )
    ]


def test_ensure_add_succeeds_but_login_miss_leaves_password_null(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    warnings: list[tuple[str, dict[str, object]]] = []

    def _warn(event: str, **kwargs: object) -> None:
        warnings.append((event, kwargs))

    monkeypatch.setattr("worker.engram.org_member.log.warning", _warn)
    roster = FakeRoster(
        user_id="preexisting",
        login_error=UnauthorizedError("invalid email or password", status=401),
    )
    member = ensure_org_member(roster, settings, email="old@example.com")
    assert member == OrgMember(user_id="preexisting", password=None)
    assert len(roster.logins) == 1
    assert warnings == [
        (
            settings.log_engram_credential_unavailable,
            {"reason": "password_not_accepted", "engram_user_id": "preexisting"},
        )
    ]


def test_ensure_skip_probe_raises(settings: WorkerSettings) -> None:
    roster = FakeRoster()
    try:
        ensure_org_member(roster, settings, email="probe-1@example.test")
    except BrainError as exc:
        assert str(exc) == settings.log_engram_join_skipped
    else:
        raise AssertionError("expected BrainError")
    assert roster.passwords == []


def test_ensure_conflict_without_roster_entry_raises(settings: WorkerSettings) -> None:
    roster = FakeRoster(add_error=ConflictError("exists", status=409), listed=[])
    try:
        ensure_org_member(roster, settings, email="nobody@example.com")
    except ConflictError:
        return
    raise AssertionError("expected ConflictError")


class _Member:
    def __init__(self, user_id: str, email: str) -> None:
        self.user_id = user_id
        self.email = email


class _Members:
    def __init__(self, *, boom: bool = False) -> None:
        self.boom = boom
        self.closed = False

    def add(self, email: str, name: str = "", role: str = "member", password: str = ""):
        del name, role, password
        if self.boom:
            raise SdkForbiddenError(403, "missing permission(s): ['members:manage']")
        return _Member("3a07018e-b5c2-483a-b80f-07e90488b5f4", email)

    def list(self):
        return [
            _Member("listed-id", "keep@example.com"),
            _Member("", "skip-empty-id@example.com"),
            _Member("skip-empty-email", ""),
        ]


class _Auth:
    def __init__(
        self,
        *,
        boom: Exception | None = None,
        token: str | None = "tok",
    ) -> None:
        self.boom = boom
        self.token = token
        self.calls: list[tuple[str, str]] = []

    def login(self, email: str, password: str):
        self.calls.append((email, password))
        if self.boom is not None:
            raise self.boom
        if self.token is None:
            return {}
        return {"token": self.token, "expires_in": 43200}


class _Client:
    def __init__(
        self,
        *,
        boom: bool = False,
        login_boom: Exception | None = None,
        token: str | None = "tok",
    ) -> None:
        self.members = _Members(boom=boom)
        self.auth = _Auth(boom=login_boom, token=token)
        self.closed = False

    def close(self) -> None:
        self.closed = True


def test_sdk_roster_add_list_login_and_close() -> None:
    client = _Client()
    roster = SdkOrgRoster(client)
    assert roster.add_member(
        "sam@example.com",
        name="sam@example.com",
        role="member",
        password="kept-secret",
    ) == "3a07018eb5c2483ab80f07e90488b5f4"
    assert roster.list_members() == [("keep@example.com", "listed-id")]
    roster.login("sam@example.com", "kept-secret")
    assert client.auth.calls == [("sam@example.com", "kept-secret")]
    roster.close()
    assert client.closed is True


def test_sdk_roster_maps_forbidden() -> None:
    roster = SdkOrgRoster(_Client(boom=True))
    try:
        roster.add_member("a@b.com", name="a", role="member", password="pw")
    except ForbiddenError as exc:
        assert exc.status == 403
    else:
        raise AssertionError("expected ForbiddenError")


def test_sdk_roster_login_maps_unauthorized() -> None:
    roster = SdkOrgRoster(
        _Client(login_boom=SdkUnauthorizedError(401, "invalid email or password")),
    )
    try:
        roster.login("a@b.com", "pw")
    except UnauthorizedError as exc:
        assert exc.status == 401
    else:
        raise AssertionError("expected UnauthorizedError")
