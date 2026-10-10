"""Exercise each dependency failure through the real turn runner.

Does not take the live product down. The brain and the speaking LLM are
replaced with stubs that raise the same errors a dead host would.
"""

from __future__ import annotations

import json
import sys
from unittest.mock import patch
from uuid import UUID

from worker.admin.store import connect, probe_persona
from worker.config import load_settings
from worker.engram.errors import ServerError
from worker.engram.interface import ChatOutcome, RetrieveHit, RetrieveOutcome
from worker.notices import notice_payload, publish_notice
from worker.persistence.sessions import create_session
from worker.persistence.subscriptions import (
    restore_subscription,
    subscription_status,
    upsert_active_subscription,
)
from worker.reframe.errors import ReframeUnavailableError
from worker.schema import SESSION_CHANNEL_TEXT
from worker.turn.errors import TurnError
from worker.turn.service import TurnRunner

failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failed
    extra = f" {detail}" if detail else ""
    if ok:
        print(f"{name}=ok{extra}")
        return
    print(f"{name}=FAIL{extra}", file=sys.stderr)
    failed += 1


class DeadBrain:
    def retrieve(self, *_args: object, **_kwargs: object) -> RetrieveOutcome:
        raise ServerError("connection refused", status=503)

    def retrieve_scoped(self, *_args: object, **_kwargs: object) -> RetrieveOutcome:
        raise ServerError("connection refused", status=503)

    def chat(self, *_args: object, **_kwargs: object) -> object:
        raise ServerError("connection refused", status=503)

    def converse(self, *_args: object, **_kwargs: object) -> None:
        return None

    def ingest_private_text(self, *_args: object, **_kwargs: object) -> None:
        return None

    def subscribe(self, *_args: object, **_kwargs: object) -> dict[str, bool]:
        # Join is skipped via a temporary mirrored subscription; this is a guard.
        return {"subscribed": True}


class GroundedBrain:
    def retrieve(self, *_args: object, **_kwargs: object) -> RetrieveOutcome:
        return RetrieveOutcome(
            results=[
                RetrieveHit(
                    tenant="probe-org:probe-persona",
                    text="A remembered fact.",
                    raw={"text": "A remembered fact."},
                )
            ],
            raw={},
        )

    def retrieve_scoped(self, *_args: object, **_kwargs: object) -> RetrieveOutcome:
        return self.retrieve()

    def chat(self, *_args: object, **_kwargs: object) -> ChatOutcome:
        return ChatOutcome(
            messages=["A remembered fact."],
            text="A remembered fact.",
            memories_used=[],
            session_id=None,
            raw={},
            brain_ms=1,
        )

    def converse(self, *_args: object, **_kwargs: object) -> None:
        return None

    def ingest_private_text(self, *_args: object, **_kwargs: object) -> None:
        return None

    def subscribe(self, *_args: object, **_kwargs: object) -> dict[str, bool]:
        return {"subscribed": True}


def _session(settings):  # noqa: ANN001
    conn = connect(settings)
    try:
        persona = probe_persona(conn, settings)
        if persona is None:
            raise SystemExit("FAIL: no published persona recorded locally")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, engram_user_id
                FROM users
                ORDER BY created_at
                LIMIT 1
                """
            )
            user = cur.fetchone()
        if user is None:
            raise SystemExit("FAIL: no app user in the database")
        user_id = UUID(str(user["id"]))
        persona_id = UUID(str(persona["id"]))
        # Stub Engram/reframe; mirror the grant so fail-closed join does not
        # call live People. Restore whatever was here when the probe exits.
        prior_subscription = subscription_status(conn, user_id, persona_id)
        upsert_active_subscription(conn, user_id, persona_id)
        session = create_session(
            conn,
            user_id=user["id"],
            persona_id=persona["id"],
            channel=SESSION_CHANNEL_TEXT,
        )
        conn.commit()
        return user, persona, session, prior_subscription
    finally:
        conn.close()


def _restore_subscription(
    settings,  # noqa: ANN001
    *,
    user_id: UUID,
    persona_id: UUID,
    prior_status: str | None,
) -> None:
    conn = connect(settings)
    try:
        restore_subscription(
            conn,
            user_id,
            persona_id,
            prior_status=prior_status,
        )
        conn.commit()
    finally:
        conn.close()


def _silence_reasons(conn, session_id: UUID) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT controller_action, controller_reasons, correlation_id
            FROM turns
            WHERE session_id = %s
            ORDER BY ordinal
            """,
            (str(session_id),),
        )
        return list(cur.fetchall())


def main() -> int:
    settings = load_settings()
    user, persona, session, prior_subscription = _session(settings)
    session_id = UUID(str(session["id"]))
    app_user_id = UUID(str(user["id"]))
    persona_id = UUID(str(persona["id"]))
    engram_user_id = user["engram_user_id"]

    try:
        payload = json.loads(
            notice_payload(
                session_id,
                settings.failure_code_engram,
                settings.failure_message_engram,
            )
        )
        check("notice_payload_code", payload["code"] == settings.failure_code_engram)
        check("notice_payload_session", payload["session_id"] == str(session_id))

        dead_settings = settings.model_copy(update={"redis_url": "redis://127.0.0.1:1/0"})
        try:
            publish_notice(
                dead_settings,
                session_id,
                settings.failure_code_engram,
                settings.failure_message_engram,
            )
            check("notice_survives_dead_redis", True)
        except Exception as exc:  # noqa: BLE001
            check("notice_survives_dead_redis", False, str(exc))

        runner = TurnRunner(settings)
        runner._brains.get = lambda _uid: DeadBrain()  # type: ignore[method-assign]

        try:
            runner.begin(
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                persona_id=persona_id,
                session_id=session_id,
                text="What are you working on?",
            )
            check("engram_down_raises", False)
        except TurnError as exc:
            check("engram_down_raises", True)
            check("engram_code", exc.code == settings.failure_code_engram)
            check("engram_message", str(exc) == settings.failure_message_engram)
            check("engram_status_unavailable", exc.status in {502, 503})

        conn = connect(settings)
        try:
            rows = _silence_reasons(conn, session_id)
        finally:
            conn.close()
        check("engram_silence_recorded", len(rows) >= 1)
        if rows:
            check(
                "engram_controller_silence",
                rows[0]["controller_action"] == "silence",
                str(rows[0]["controller_reasons"]),
            )
            check(
                "engram_silence_has_correlation",
                all(row["correlation_id"] is not None for row in rows),
            )

        empty = runner.begin(
            app_user_id=app_user_id,
            engram_user_id=engram_user_id,
            persona_id=persona_id,
            session_id=session_id,
            text="   ",
        )
        empty.spoken = "this reply must still exist if persist dies"
        with patch(
            "worker.turn.service.borrow",
            side_effect=RuntimeError("postgres gone"),
        ):
            lost = runner.finish(empty)
        check("record_lost_does_not_raise", lost.recorded is False)
        check("record_lost_keeps_reply", lost.reply_text == empty.spoken)
        check("record_lost_code", lost.warning_code == settings.failure_code_record)
        check("record_lost_message", lost.warning == settings.failure_message_record)

        runner._brains.get = lambda _uid: GroundedBrain()  # type: ignore[method-assign]

        def dead_llm() -> None:
            raise ReframeUnavailableError("openai unreachable")

        runner._llm = dead_llm  # type: ignore[method-assign]
        speaking = runner.begin(
            app_user_id=app_user_id,
            engram_user_id=engram_user_id,
            persona_id=persona_id,
            session_id=session_id,
            text="What are you working on?",
        )
        check("speaking_plan_speaks", speaking.speaks)
        try:
            runner.speak(speaking)
            check("speaking_llm_raises", False)
        except TurnError as exc:
            check("speaking_llm_raises", True)
            check("speaking_llm_code", exc.code == settings.failure_code_speaking_llm)
            check(
                "speaking_llm_message",
                str(exc) == settings.failure_message_speaking_llm,
            )

        class PartialStream:
            def stream(self, *_args: object, **_kwargs: object):
                yield "Hello "
                raise ReframeUnavailableError("cut off")

            def answer(self, *_args: object, **_kwargs: object) -> str:
                raise ReframeUnavailableError("cut off")

        runner._answerer = PartialStream()  # type: ignore[assignment]
        runner._reframer = PartialStream()  # type: ignore[assignment]
        streamed = runner.begin(
            app_user_id=app_user_id,
            engram_user_id=engram_user_id,
            persona_id=persona_id,
            session_id=session_id,
            text="What are you working on?",
        )
        pieces: list[str] = []
        try:
            for piece in runner.stream_speak(streamed):
                pieces.append(piece)
            check("speaking_stream_raises", False)
        except ReframeUnavailableError:
            check("speaking_stream_raises", True)
        check("speaking_stream_kept_partial", "".join(pieces) == "Hello ")
        check("speaking_stream_plan_keeps_partial", streamed.spoken == "Hello")

        with patch(
            "worker.turn.service.borrow",
            side_effect=RuntimeError("postgres gone at start"),
        ):
            try:
                runner.begin(
                    app_user_id=app_user_id,
                    engram_user_id=engram_user_id,
                    persona_id=persona_id,
                    session_id=session_id,
                    text="hello",
                )
                check("database_down_at_start_raises", False)
            except TurnError as exc:
                check("database_down_at_start_raises", True)
                check("database_code", exc.code == settings.failure_code_database)
                check(
                    "database_message",
                    str(exc) == settings.failure_message_database,
                )

        runner.close()
    finally:
        _restore_subscription(
            settings,
            user_id=app_user_id,
            persona_id=persona_id,
            prior_status=prior_subscription,
        )

    if failed:
        print(f"FAIL: {failed} check(s)", file=sys.stderr)
        return 1
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
