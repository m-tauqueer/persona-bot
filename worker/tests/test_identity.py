from uuid import uuid4

from worker.turn.identity import session_identity_reason, stored_engram_matches


def test_matching_identity_is_ok() -> None:
    user = uuid4()
    persona = uuid4()
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=persona,
            stored_engram_user_id="engram-a",
            claimed_app_user_id=user,
            claimed_persona_id=persona,
            claimed_engram_user_id="engram-a",
        )
        is None
    )


def test_session_mismatch() -> None:
    assert (
        session_identity_reason(
            session_user_id=uuid4(),
            session_persona_id=uuid4(),
            stored_engram_user_id="engram-a",
            claimed_app_user_id=uuid4(),
            claimed_persona_id=uuid4(),
            claimed_engram_user_id="engram-a",
        )
        == "session_mismatch"
    )


def test_persona_mismatch() -> None:
    user = uuid4()
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=uuid4(),
            stored_engram_user_id="engram-a",
            claimed_app_user_id=user,
            claimed_persona_id=uuid4(),
            claimed_engram_user_id="engram-a",
        )
        == "persona_mismatch"
    )


def test_identity_mismatch_when_stored_engram_differs() -> None:
    user = uuid4()
    persona = uuid4()
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=persona,
            stored_engram_user_id="engram-a",
            claimed_app_user_id=user,
            claimed_persona_id=persona,
            claimed_engram_user_id="engram-b",
        )
        == "identity_mismatch"
    )
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=persona,
            stored_engram_user_id=None,
            claimed_app_user_id=user,
            claimed_persona_id=persona,
            claimed_engram_user_id="engram-a",
        )
        == "identity_mismatch"
    )


def test_stored_engram_matches() -> None:
    assert stored_engram_matches("abc", "abc") is True
    assert stored_engram_matches(None, "abc") is False
    assert stored_engram_matches("abc", "xyz") is False


def test_admit_placeholder_matches_after_people_remap() -> None:
    user = uuid4()
    persona = uuid4()
    placeholder = user.hex
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=persona,
            stored_engram_user_id="8de1b2b278724e0bba19000086f8bef2",
            claimed_app_user_id=user,
            claimed_persona_id=persona,
            claimed_engram_user_id=placeholder,
        )
        is None
    )
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=persona,
            stored_engram_user_id="8de1b2b278724e0bba19000086f8bef2",
            claimed_app_user_id=user,
            claimed_persona_id=persona,
            claimed_engram_user_id=uuid4().hex,
        )
        == "identity_mismatch"
    )
    hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4"
    hex_id = "3a07018eb5c2483ab80f07e90488b5f4"
    assert stored_engram_matches(hyphenated, hex_id) is True
    assert stored_engram_matches(hex_id, hyphenated) is True
    user = uuid4()
    persona = uuid4()
    assert (
        session_identity_reason(
            session_user_id=user,
            session_persona_id=persona,
            stored_engram_user_id=hyphenated,
            claimed_app_user_id=user,
            claimed_persona_id=persona,
            claimed_engram_user_id=hex_id,
        )
        is None
    )
