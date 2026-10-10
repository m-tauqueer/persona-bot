from __future__ import annotations

from contextlib import contextmanager
from uuid import uuid4

from worker.config import WorkerSettings
from worker.engram.member_secret import (
    ciphertext_for_password,
    decode_member_secret_key,
    decrypt_member_secret,
)
from worker.engram.org_member import OrgMember
from worker.persistence.sessions import set_user_engram_id
from worker.turn.service import TurnRunner


class _Cursor:
    def __init__(self, conn: _Conn) -> None:
        self._conn = conn

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        self._conn.statements.append((sql, params))


class _Conn:
    def __init__(self) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.commits = 0

    def cursor(self) -> _Cursor:
        return _Cursor(self)

    def commit(self) -> None:
        self.commits += 1


def test_set_user_engram_id_writes_secret_in_the_same_statement() -> None:
    conn = _Conn()
    user_id = uuid4()
    set_user_engram_id(
        conn,  # type: ignore[arg-type]
        user_id,
        "engine-id",
        member_secret="ciphertext",
    )
    assert len(conn.statements) == 1
    sql, params = conn.statements[0]
    assert "engram_user_id" in sql
    assert "engram_member_secret" in sql
    assert "COALESCE" in sql
    assert params == ("engine-id", "ciphertext", str(user_id))


def test_new_member_persist_commits_id_and_secret_together(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    conn = _Conn()

    @contextmanager
    def fake_borrow(_settings: WorkerSettings):
        yield conn

    monkeypatch.setattr("worker.turn.service.borrow", fake_borrow)
    runner = TurnRunner(settings)
    member = OrgMember(user_id="abc123", password="correct-horse-battery")
    stored = "ffffffffffffffffffffffffffffffff"
    try:
        engine_id = runner._persist_engram_member(uuid4(), stored, member)
        assert engine_id == "abc123"
        assert conn.commits == 1
        assert len(conn.statements) == 1
        sql, params = conn.statements[0]
        assert "engram_user_id" in sql
        assert "engram_member_secret" in sql
        ciphertext = params[1]
        assert isinstance(ciphertext, str)
        assert ciphertext != member.password
        key = decode_member_secret_key(settings.engram_member_secret_key or "")
        assert decrypt_member_secret(ciphertext, key=key) == member.password
    finally:
        runner.close()


def test_uncredentialed_member_persist_writes_id_and_null_secret(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    conn = _Conn()

    @contextmanager
    def fake_borrow(_settings: WorkerSettings):
        yield conn

    monkeypatch.setattr("worker.turn.service.borrow", fake_borrow)
    runner = TurnRunner(settings)
    member = OrgMember(user_id="listed-id", password=None)
    try:
        engine_id = runner._persist_engram_member(
            uuid4(),
            "ffffffffffffffffffffffffffffffff",
            member,
        )
        assert engine_id == "listed-id"
        assert conn.commits == 1
        _, params = conn.statements[0]
        assert params[0] == "listed-id"
        assert params[1] is None
    finally:
        runner.close()


def test_uncredentialed_member_with_matching_id_does_not_write(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    conn = _Conn()

    @contextmanager
    def fake_borrow(_settings: WorkerSettings):
        yield conn

    monkeypatch.setattr("worker.turn.service.borrow", fake_borrow)
    runner = TurnRunner(settings)
    member = OrgMember(user_id="listed-id", password=None)
    try:
        engine_id = runner._persist_engram_member(uuid4(), "listed-id", member)
        assert engine_id == "listed-id"
        assert conn.statements == []
        assert conn.commits == 0
    finally:
        runner.close()


def test_ciphertext_for_password_is_none_without_key() -> None:
    assert ciphertext_for_password("pw", key=None) is None
    assert ciphertext_for_password(None, key=b"c" * 32) is None
