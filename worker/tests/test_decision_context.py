import json

from worker.config import WorkerSettings
from worker.decisions.context import DecisionContext
from worker.reframe.types import HistoryTurn


def test_context_preserves_question_speakers_and_only_identity_fields(
    settings: WorkerSettings,
) -> None:
    history = [
        HistoryTurn("user", "My project is Cedar."),
        HistoryTurn("persona", "Tell me about it."),
    ]
    context = DecisionContext.from_turn(
        "How can you help it?",
        history,
        {"name": "Ada", "description": "An engineer", "api_key": "never-send"},
        settings,
    )
    history.clear()
    payload = json.loads(context.serialize(settings))
    assert payload["question"] == "How can you help it?"
    assert [row["speaker"] for row in payload["history"]] == ["user", "persona"]
    assert "never-send" not in json.dumps(payload)


def test_context_byte_caps_drop_oldest_without_truncating_question(
    settings: WorkerSettings,
) -> None:
    context = DecisionContext("é" * 20, (HistoryTurn("user", "old" * 200),))
    required = context.serialize(
        settings.model_copy(update={"decisions_history_turns": 0})
    )
    capped = settings.model_copy(
        update={"decisions_input_max_bytes": len(required.encode())}
    )
    assert context.serialize(capped) == required
    assert json.loads(required)["question"] == "é" * 20
    assert (
        context.serialize(capped.model_copy(update={"decisions_input_max_bytes": 1}))
        is None
    )


def test_context_turn_cap_and_custom_keys(settings: WorkerSettings) -> None:
    loaded = settings.model_copy(
        update={
            "decisions_history_turns": 1,
            "decisions_context_history_key": "sitting",
            "engram_scope_router_question_key": "ask",
        }
    )
    context = DecisionContext(
        "q", (HistoryTurn("user", "old"), HistoryTurn("user", "new"))
    )
    payload = json.loads(context.serialize(loaded))
    assert payload["sitting"] == [{"speaker": "user", "text": "new"}]
    assert payload["ask"] == "q"
