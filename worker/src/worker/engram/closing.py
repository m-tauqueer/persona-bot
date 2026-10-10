from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

import structlog

from worker.engram.caller_facts import CallerFactExtract, stamp_caller_fact
from worker.engram.errors import BrainError
from worker.persistence.db import borrow
from worker.persistence.personas import get_persona
from worker.persistence.receipts import claim_closing_pass
from worker.persistence.sessions import get_session, user_email, user_engram_id
from worker.persistence.turns import sitting_history
from worker.reframe.types import HistoryTurn

if TYPE_CHECKING:
    from worker.turn.service import TurnRunner

log = structlog.get_logger(__name__)


def split_closing_window(
    turns: list[HistoryTurn],
    *,
    user_speaker: str,
    persona_speaker: str,
) -> tuple[list[HistoryTurn], str, str]:
    """Peel the last labelled pair off the sitting. Speakers come from config."""
    rest = list(turns)
    persona_reply = ""
    user_turn = ""
    if rest and rest[-1].speaker == persona_speaker:
        persona_reply = rest[-1].text
        rest = rest[:-1]
    if rest and rest[-1].speaker == user_speaker:
        user_turn = rest[-1].text
        rest = rest[:-1]
    return rest, user_turn, persona_reply


def run_closing_pass(
    runner: TurnRunner,
    session_id: UUID,
    app_user_id: UUID,
) -> None:
    """Off the client path. Same extractor as per-turn write-back. Never dumps."""
    settings = runner._settings
    try:
        with borrow(settings) as conn:
            session = get_session(conn, session_id)
    except Exception:
        log.warning(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.engram_writeback_reason_claim_failed,
        )
        return
    if session is None or UUID(str(session["user_id"])) != app_user_id:
        log.info(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.caller_fact_closing_reason_missing,
        )
        return
    if session["ended_at"] is None:
        log.info(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.caller_fact_closing_reason_not_ended,
        )
        return
    try:
        with borrow(settings) as conn:
            claimed = claim_closing_pass(conn, session_id, app_user_id)
            conn.commit()
    except Exception:
        log.warning(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.engram_writeback_reason_claim_failed,
        )
        return
    if not claimed:
        log.info(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.caller_fact_closing_reason_already,
        )
        return
    if (
        not settings.engram_converse_writeback
        or not settings.engram_member_session_auth
    ):
        log.info(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.engram_writeback_reason_unauthenticated,
        )
        return
    try:
        with borrow(settings) as conn:
            turns = sitting_history(
                conn,
                session_id,
                max_turns=settings.caller_fact_closing_max_turns,
                max_bytes=settings.caller_fact_closing_max_bytes,
            )
            email = user_email(conn, app_user_id) or ""
            engram_user_id = user_engram_id(conn, app_user_id)
            persona = get_persona(conn, UUID(str(session["persona_id"])))
    except Exception:
        log.warning(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.engram_writeback_reason_claim_failed,
        )
        return
    if not engram_user_id or persona is None:
        log.warning(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.engram_writeback_reason_unauthenticated,
        )
        return
    engram_persona_id = persona["engram_persona_id"]
    if not isinstance(engram_persona_id, str) or not engram_persona_id:
        log.warning(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.engram_writeback_reason_unauthenticated,
        )
        return
    history, user_turn, persona_reply = split_closing_window(
        turns,
        user_speaker=settings.engram_converse_user_speaker,
        persona_speaker=settings.engram_converse_persona_speaker,
    )
    extracted = _extract_with_retry(
        runner,
        history=history,
        user_turn=user_turn,
        persona_reply=persona_reply,
    )
    success = {
        settings.caller_fact_reason_empty,
        settings.caller_fact_reason_extracted,
    }
    if extracted.reason not in success:
        log.info(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=extracted.reason,
        )
        return
    if not extracted.facts:
        log.info(
            settings.log_engram_closing,
            session_id=str(session_id),
            reason=settings.caller_fact_reason_empty,
        )
        return
    written = 0
    for fact in extracted.facts:
        try:
            stored = runner._run_member_op(
                None,
                member_authenticated=True,
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                email=email,
                op=lambda active, body=stamp_caller_fact(
                    fact,
                    settings,
                ): active.ingest_private_text(
                    engram_persona_id,
                    body,
                ),
            )
            if stored is None:
                log.warning(
                    settings.log_engram_closing,
                    session_id=str(session_id),
                    reason=settings.engram_writeback_reason_unauthenticated,
                )
                return
            written += 1
        except BrainError:
            log.warning(
                settings.log_engram_closing,
                session_id=str(session_id),
                reason=settings.engram_writeback_reason_write_failed,
            )
            return
        except Exception:  # noqa: BLE001 - a writer thread must not die
            log.warning(
                settings.log_engram_closing,
                session_id=str(session_id),
                reason=settings.engram_writeback_reason_write_failed,
            )
            return
    log.info(
        settings.log_engram_closing,
        session_id=str(session_id),
        reason=settings.caller_fact_reason_extracted,
        fact_count=written,
    )


def _extract_with_retry(
    runner: TurnRunner,
    *,
    history: list[HistoryTurn],
    user_turn: str,
    persona_reply: str,
) -> CallerFactExtract:
    settings = runner._settings
    success = {
        settings.caller_fact_reason_empty,
        settings.caller_fact_reason_extracted,
    }
    attempts = settings.caller_fact_closing_retries + 1
    extracted = CallerFactExtract([], settings.caller_fact_reason_error)
    for _ in range(attempts):
        extracted = runner._extract_client().extract(
            history=history,
            user_turn=user_turn,
            persona_reply=persona_reply,
            history_limit=settings.caller_fact_closing_max_turns,
            closing=True,
        )
        if extracted.reason in success:
            return extracted
    return extracted
