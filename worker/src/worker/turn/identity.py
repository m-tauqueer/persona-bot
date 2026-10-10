from __future__ import annotations

from uuid import UUID

from worker.engram.user_id import persona_engine_user_id


def admit_placeholder_id(app_user_id: UUID) -> str:
    return persona_engine_user_id(str(app_user_id))


def claimed_is_admit_placeholder(*, app_user_id: UUID, claimed: str) -> bool:
    return persona_engine_user_id(claimed) == admit_placeholder_id(app_user_id)


def session_identity_reason(
    *,
    session_user_id: UUID,
    session_persona_id: UUID,
    stored_engram_user_id: str | None,
    claimed_app_user_id: UUID,
    claimed_persona_id: UUID,
    claimed_engram_user_id: str,
) -> str | None:
    """Return a refuse reason, or None when the claimed identity matches."""
    if session_user_id != claimed_app_user_id:
        return "session_mismatch"
    if session_persona_id != claimed_persona_id:
        return "persona_mismatch"
    if stored_engram_matches(stored_engram_user_id, claimed_engram_user_id):
        return None
    # Voice pins headers at call start. First talk may persist Engram's id
    # while later utterances still send the admit placeholder.
    if stored_engram_user_id and claimed_is_admit_placeholder(
        app_user_id=claimed_app_user_id,
        claimed=claimed_engram_user_id,
    ):
        return None
    return "identity_mismatch"


def stored_engram_matches(stored: str | None, claimed: str) -> bool:
    if stored is None:
        return False
    return persona_engine_user_id(stored) == persona_engine_user_id(claimed)
