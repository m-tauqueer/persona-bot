from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from worker.api.closing import build_closing_router
from worker.config import WorkerSettings
from worker.engram.caller_facts import CallerFactExtract, stamp_caller_fact
from worker.engram.closing import run_closing_pass, split_closing_window
from worker.engram.errors import BrainError
from worker.persistence.turns import cap_sitting
from worker.reframe.types import HistoryTurn
from worker.turn.service import TurnRunner

APP_USER = uuid4()
OTHER = uuid4()
PERSONA = uuid4()
SESSION = uuid4()
ENGRAM_PERSONA = "eng-persona-1"
ENGRAM_USER = "eng-user-1"


class _Conn:
    def commit(self) -> None:
        return None


class _Borrow:
    def __enter__(self) -> _Conn:
        return _Conn()

    def __exit__(self, *args: object) -> bool:
        return False


class _Extract:
    def __init__(self, results: list[CallerFactExtract]) -> None:
        self.results = list(results)
        self.calls: list[dict[str, object]] = []

    def extract(
        self,
        *,
        history: list[HistoryTurn],
        user_turn: str,
        persona_reply: str,
        history_limit: int | None = None,
        closing: bool = False,
    ) -> CallerFactExtract:
        self.calls.append(
            {
                "history": history,
                "user_turn": user_turn,
                "persona_reply": persona_reply,
                "history_limit": history_limit,
                "closing": closing,
            }
        )
        if not self.results:
            raise AssertionError("unexpected extract")
        return self.results.pop(0)


def _ended_session(*, user_id=APP_USER, ended: bool = True) -> dict[str, object]:
    return {
        "user_id": user_id,
        "persona_id": PERSONA,
        "ended_at": datetime.now(tz=UTC) if ended else None,
    }


def _stub_closing(
    monkeypatch: pytest.MonkeyPatch,
    *,
    session: dict[str, object] | None,
    claimed: bool = True,
    turns: list[HistoryTurn] | None = None,
    email: str = "a@example.com",
    engram_user: str | None = ENGRAM_USER,
    persona: dict[str, object] | None = None,
) -> dict[str, list[object]]:
    from worker.engram import closing as closing_mod

    calls: dict[str, list[object]] = {"claim": []}
    monkeypatch.setattr(closing_mod, "borrow", lambda _s: _Borrow())
    monkeypatch.setattr(closing_mod, "get_session", lambda *_a, **_k: session)

    def _claim(*args: object, **kwargs: object) -> bool:
        calls["claim"].append((args, kwargs))
        return claimed

    monkeypatch.setattr(closing_mod, "claim_closing_pass", _claim)
    monkeypatch.setattr(
        closing_mod,
        "sitting_history",
        lambda *_a, **_k: turns or [],
    )
    monkeypatch.setattr(closing_mod, "user_email", lambda *_a, **_k: email)
    monkeypatch.setattr(closing_mod, "user_engram_id", lambda *_a, **_k: engram_user)
    monkeypatch.setattr(
        closing_mod,
        "get_persona",
        lambda *_a, **_k: persona
        if persona is not None
        else {"engram_persona_id": ENGRAM_PERSONA},
    )
    return calls


def test_cap_sitting_keeps_newest_turns_and_byte_budget() -> None:
    turns = [
        HistoryTurn(speaker="user", text="one"),
        HistoryTurn(speaker="persona", text="two"),
        HistoryTurn(speaker="user", text="three"),
    ]
    capped = cap_sitting(turns, max_turns=2, max_bytes=10_000)
    assert [turn.text for turn in capped] == ["two", "three"]
    empty = cap_sitting(turns, max_turns=0, max_bytes=100)
    assert empty == []


def test_cap_sitting_drops_oldest_until_bytes_fit() -> None:
    turns = [
        HistoryTurn(speaker="user", text="aa"),
        HistoryTurn(speaker="persona", text="bb"),
        HistoryTurn(speaker="user", text="cc"),
    ]
    # "aa"+"bb"+"cc" is 6 bytes; keep a suffix that fits in 4.
    capped = cap_sitting(turns, max_turns=10, max_bytes=4)
    assert [turn.text for turn in capped] == ["bb", "cc"]


def test_split_closing_window_uses_configured_speakers(
    settings: WorkerSettings,
) -> None:
    turns = [
        HistoryTurn(
            speaker=settings.engram_converse_user_speaker,
            text="I live in Pune",
        ),
        HistoryTurn(
            speaker=settings.engram_converse_persona_speaker,
            text="good to know",
        ),
    ]
    history, user_turn, persona_reply = split_closing_window(
        turns,
        user_speaker=settings.engram_converse_user_speaker,
        persona_speaker=settings.engram_converse_persona_speaker,
    )
    assert history == []
    assert user_turn == "I live in Pune"
    assert persona_reply == "good to know"


def test_closing_pass_double_hangup_extracts_once(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    settings.engram_converse_writeback = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        [
            CallerFactExtract(
                ["The caller lives in Pune."],
                settings.caller_fact_reason_extracted,
            )
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    ingested: list[str] = []

    def _run(*_a: object, **kwargs: object) -> dict[str, bool]:
        op = kwargs["op"]
        assert callable(op)

        class _Active:
            def ingest_private_text(
                self, persona_id: str, text: str
            ) -> dict[str, bool]:
                ingested.append(text)
                assert persona_id == ENGRAM_PERSONA
                return {"ok": True}

        return op(_Active())

    runner._run_member_op = _run  # type: ignore[method-assign]
    first = _stub_closing(
        monkeypatch,
        session=_ended_session(),
        claimed=True,
        turns=[
            HistoryTurn(speaker="user", text="I live in Pune"),
            HistoryTurn(speaker="persona", text="good to know"),
        ],
    )
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert ingested == [
            stamp_caller_fact("The caller lives in Pune.", settings),
        ]
        assert extractor.calls[0]["closing"] is True
        assert first["claim"]
        ingested.clear()
        extractor.results = [
            CallerFactExtract(
                ["The caller lives in Pune."],
                settings.caller_fact_reason_extracted,
            )
        ]
        _stub_closing(monkeypatch, session=_ended_session(), claimed=False)
        run_closing_pass(runner, SESSION, APP_USER)
        assert ingested == []
        assert extractor.calls
        # Second pass must not extract.
        assert len(extractor.calls) == 1
    finally:
        runner.close()


def test_closing_pass_extract_error_writes_nothing(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    settings.engram_converse_writeback = True
    settings.caller_fact_closing_retries = 1
    runner = TurnRunner(settings)
    extractor = _Extract(
        [
            CallerFactExtract([], settings.caller_fact_reason_timeout),
            CallerFactExtract([], settings.caller_fact_reason_timeout),
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("write") or {"ok": True}
    )
    _stub_closing(
        monkeypatch,
        session=_ended_session(),
        turns=[HistoryTurn(speaker="user", text="I live in Pune")],
    )
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert called == []
        assert len(extractor.calls) == 2
    finally:
        runner.close()


def test_closing_pass_retries_extract_then_writes(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    settings.engram_converse_writeback = True
    settings.caller_fact_closing_retries = 1
    runner = TurnRunner(settings)
    fact = "The caller lives in Pune."
    extractor = _Extract(
        [
            CallerFactExtract([], settings.caller_fact_reason_timeout),
            CallerFactExtract([fact], settings.caller_fact_reason_extracted),
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    ingested: list[str] = []

    def _run(*_a: object, **kwargs: object) -> dict[str, bool]:
        op = kwargs["op"]
        assert callable(op)

        class _Active:
            def ingest_private_text(
                self, persona_id: str, text: str
            ) -> dict[str, bool]:
                ingested.append(text)
                return {"ok": True}

        return op(_Active())

    runner._run_member_op = _run  # type: ignore[method-assign]
    _stub_closing(
        monkeypatch,
        session=_ended_session(),
        turns=[HistoryTurn(speaker="user", text="I live in Pune")],
    )
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert ingested == [stamp_caller_fact(fact, settings)]
        assert len(extractor.calls) == 2
    finally:
        runner.close()


def test_closing_pass_wrong_owner_does_not_claim(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        [
            CallerFactExtract(
                ["The caller lives in Pune."],
                settings.caller_fact_reason_extracted,
            )
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("write") or {"ok": True}
    )
    calls = _stub_closing(
        monkeypatch,
        session=_ended_session(user_id=OTHER),
    )
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert calls["claim"] == []
        assert extractor.calls == []
        assert called == []
    finally:
        runner.close()


def test_closing_pass_brain_error_does_not_dump(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    settings.engram_converse_writeback = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        [
            CallerFactExtract(
                ["The caller lives in Pune."],
                settings.caller_fact_reason_extracted,
            )
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    conversed: list[str] = []

    def _run(*_a: object, **kwargs: object) -> dict[str, bool]:
        op = kwargs["op"]
        assert callable(op)

        class _Active:
            def ingest_private_text(
                self, *args: object, **kw: object
            ) -> dict[str, bool]:
                raise BrainError("ingest failed")

            def converse(self, *args: object, **kw: object) -> dict[str, bool]:
                conversed.append("converse")
                return {"ok": True}

        return op(_Active())

    runner._run_member_op = _run  # type: ignore[method-assign]
    _stub_closing(
        monkeypatch,
        session=_ended_session(),
        turns=[HistoryTurn(speaker="user", text="I live in Pune")],
    )
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert conversed == []
    finally:
        runner.close()


def test_closing_pass_open_sitting_does_not_claim(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    settings.engram_converse_writeback = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        [
            CallerFactExtract(
                ["The caller lives in Pune."],
                settings.caller_fact_reason_extracted,
            )
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    calls = _stub_closing(
        monkeypatch,
        session=_ended_session(ended=False),
    )
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert calls["claim"] == []
        assert extractor.calls == []
    finally:
        runner.close()


def test_closing_pass_writeback_off_claims_and_skips_write(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.engram_member_session_auth = True
    settings.engram_converse_writeback = False
    runner = TurnRunner(settings)
    extractor = _Extract(
        [
            CallerFactExtract(
                ["The caller lives in Pune."],
                settings.caller_fact_reason_extracted,
            )
        ]
    )
    runner._extractor = extractor  # type: ignore[assignment]
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("write") or {"ok": True}
    )
    calls = _stub_closing(monkeypatch, session=_ended_session(), claimed=True)
    try:
        run_closing_pass(runner, SESSION, APP_USER)
        assert calls["claim"]
        assert extractor.calls == []
        assert called == []
    finally:
        runner.close()


def test_closing_router_returns_accepted_without_running_job(
    settings: WorkerSettings,
) -> None:
    class _Runner:
        def __init__(self) -> None:
            self.calls: list[tuple[object, object]] = []

        def enqueue_closing_pass(self, session_id: object, app_user_id: object) -> None:
            self.calls.append((session_id, app_user_id))

    fake = _Runner()
    app = FastAPI()
    app.include_router(build_closing_router(settings, fake))  # type: ignore[arg-type]
    client = TestClient(app)
    response = client.post(
        settings.internal_closing_path,
        headers={settings.internal_secret_header: settings.internal_api_secret},
        json={"session_id": str(SESSION), "app_user_id": str(APP_USER)},
    )
    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    assert fake.calls == [(SESSION, APP_USER)]
