from worker.admin.errors import AdminError
from worker.admin.store import pick_single_persona
from worker.persistence.personas import visible_to_members


def test_unpublished_and_missing_are_hidden_from_members() -> None:
    assert visible_to_members(None) is None
    assert visible_to_members({"id": "1", "published": False}) is None
    row = {"id": "1", "published": True}
    assert visible_to_members(row) is row


def test_pick_single_persona_does_not_use_env_to_guess() -> None:
    assert pick_single_persona([], error="pin required") is None
    only = {"id": "ada"}
    assert pick_single_persona([only], error="pin required") is only
    try:
        pick_single_persona([{"id": "ada"}, {"id": "nova"}], error="pin required")
        raise AssertionError("expected pin required")
    except AdminError as exc:
        assert exc.status == 409
        assert exc.reason == "persona_pin_required"
        assert str(exc) == "pin required"
        assert "ENGRAM_PERSONA_ID" not in str(exc)
