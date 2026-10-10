import json
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pytest
from openai import APITimeoutError, OpenAIError

from worker.config import WorkerSettings
from worker.engram.caller_fact_defaults import (
    DEFAULT_CALLER_FACT_CLOSING_SYSTEM_PROMPT,
    DEFAULT_CALLER_FACT_SYSTEM_PROMPT,
    render_caller_fact_prompt,
)
from worker.engram.caller_facts import (
    CallerFactExtract,
    CallerFactExtractor,
    stamp_caller_fact,
)
from worker.reframe.types import HistoryTurn


class _DummyClient:
    pass


def _json_facts(settings: WorkerSettings, facts: list[str]) -> str:
    return json.dumps({settings.caller_fact_payload_facts_key: facts})


def test_render_prompt_substitutes_config_tokens_only() -> None:
    rendered = render_caller_fact_prompt(
        DEFAULT_CALLER_FACT_SYSTEM_PROMPT,
        {
            "history_key": "turns",
            "user_turn_key": "said",
            "persona_reply_key": "replied",
            "facts_key": "facts",
            "speaker_key": "who",
            "text_key": "line",
            "fact_prefix": "The caller",
        },
    )
    assert "{history_key}" not in rendered
    assert "turns" in rendered
    assert "The caller" in rendered
    assert "correction" in rendered
    assert "unsay" in rendered
    assert 'must start with "The caller"' in rendered


def test_parse_greeting_is_empty_success(settings: WorkerSettings) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    parsed = extractor.parse(_json_facts(settings, []))
    assert parsed == CallerFactExtract([], settings.caller_fact_reason_empty)


def test_parse_live_in_pune_is_one_caller_fact(settings: WorkerSettings) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    fact = "The caller lives in Pune."
    parsed = extractor.parse(_json_facts(settings, [fact]))
    assert parsed == CallerFactExtract(
        [fact],
        settings.caller_fact_reason_extracted,
    )


def test_parse_persona_job_question_is_empty(settings: WorkerSettings) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    parsed = extractor.parse(_json_facts(settings, []))
    assert parsed.facts == []
    assert parsed.reason == settings.caller_fact_reason_empty


def test_parse_persona_self_talk_is_empty(settings: WorkerSettings) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    parsed = extractor.parse(_json_facts(settings, []))
    assert parsed.facts == []
    assert parsed.reason == settings.caller_fact_reason_empty


def test_parse_falls_closed_on_unrecognised(settings: WorkerSettings) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    closed = settings.caller_fact_reason_unrecognised
    assert extractor.parse("not-json") == CallerFactExtract([], closed)
    assert extractor.parse("[]") == CallerFactExtract([], closed)
    assert extractor.parse("{}") == CallerFactExtract([], closed)
    assert extractor.parse(
        json.dumps({settings.caller_fact_payload_facts_key: "nope"}),
    ) == CallerFactExtract([], closed)


def test_parse_drops_blank_and_caps_count(settings: WorkerSettings) -> None:
    loaded = settings.model_copy(update={"caller_fact_max_facts": 2})
    extractor = CallerFactExtractor(loaded, _DummyClient())  # type: ignore[arg-type]
    parsed = extractor.parse(
        _json_facts(
            loaded,
            ["", "  ", "The caller sails.", 3, "The caller has a dog.", "extra"],
        ),
    )
    assert parsed.facts == ["The caller sails.", "The caller has a dog."]
    assert parsed.reason == loaded.caller_fact_reason_extracted


def test_messages_are_speaker_labelled_and_do_not_merge_lists(
    settings: WorkerSettings,
) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    messages = extractor._messages(
        history=[
            HistoryTurn(speaker="user", text="hello"),
            HistoryTurn(speaker="persona", text="hi"),
        ],
        user_turn="I live in Pune",
        persona_reply="good to know",
    )
    assert messages[0]["role"] == "system"
    payload = json.loads(messages[1]["content"])
    assert payload[settings.caller_fact_payload_history_key] == [
        {
            settings.caller_fact_payload_speaker_key: "user",
            settings.caller_fact_payload_text_key: "hello",
        },
        {
            settings.caller_fact_payload_speaker_key: "persona",
            settings.caller_fact_payload_text_key: "hi",
        },
    ]
    assert payload[settings.caller_fact_payload_user_turn_key] == "I live in Pune"
    assert payload[settings.caller_fact_payload_persona_reply_key] == "good to know"
    assert settings.caller_fact_payload_facts_key not in payload


def test_messages_history_length_follows_config(settings: WorkerSettings) -> None:
    loaded = settings.model_copy(update={"reframe_history_turns": 1})
    extractor = CallerFactExtractor(loaded, _DummyClient())  # type: ignore[arg-type]
    messages = extractor._messages(
        history=[
            HistoryTurn(speaker="user", text="one"),
            HistoryTurn(speaker="persona", text="two"),
        ],
        user_turn="now",
        persona_reply="",
    )
    payload = json.loads(messages[1]["content"])
    assert payload[loaded.caller_fact_payload_history_key] == [
        {
            loaded.caller_fact_payload_speaker_key: "persona",
            loaded.caller_fact_payload_text_key: "two",
        },
    ]


def test_messages_history_limit_override_ignores_reframe_window(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(update={"reframe_history_turns": 1})
    extractor = CallerFactExtractor(loaded, _DummyClient())  # type: ignore[arg-type]
    messages = extractor._messages(
        history=[
            HistoryTurn(speaker="user", text="one"),
            HistoryTurn(speaker="persona", text="two"),
        ],
        user_turn="now",
        persona_reply="",
        history_limit=2,
    )
    payload = json.loads(messages[1]["content"])
    assert len(payload[loaded.caller_fact_payload_history_key]) == 2


def test_extract_without_client_is_closed(settings: WorkerSettings) -> None:
    extractor = CallerFactExtractor(settings, None)
    parsed = extractor.extract(history=[], user_turn="hi", persona_reply="")
    assert parsed == CallerFactExtract([], settings.caller_fact_reason_error)


def test_extract_timeout_is_closed(settings: WorkerSettings) -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")

    class Completions:
        def create(self, **_kwargs: object) -> object:
            raise APITimeoutError(request)

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    extractor = CallerFactExtractor(settings, client)  # type: ignore[arg-type]
    parsed = extractor.extract(history=[], user_turn="hi", persona_reply="")
    assert parsed == CallerFactExtract([], settings.caller_fact_reason_timeout)


def test_extract_error_is_closed(settings: WorkerSettings) -> None:
    class Completions:
        def create(self, **_kwargs: object) -> object:
            raise OpenAIError("down")

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    extractor = CallerFactExtractor(settings, client)  # type: ignore[arg-type]
    parsed = extractor.extract(history=[], user_turn="hi", persona_reply="")
    assert parsed == CallerFactExtract([], settings.caller_fact_reason_error)


def _client_returning(content: str) -> tuple[object, dict[str, object]]:
    captured: dict[str, object] = {}

    class Completions:
        def create(self, **kwargs: object) -> object:
            captured.update(kwargs)
            message = SimpleNamespace(content=content)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    return client, captured


@pytest.mark.parametrize(
    ("user_turn", "persona_reply", "facts"),
    [
        ("hi", "hello", []),
        ("I live in Pune", "good to know", ["The caller lives in Pune."]),
        ("are you working at Metacognition?", "yes", []),
        ("tell me about yourself", "I work at Metacognition", []),
    ],
)
def test_extract_mocked_model_returns_planned_facts(
    settings: WorkerSettings,
    user_turn: str,
    persona_reply: str,
    facts: list[str],
) -> None:
    client, captured = _client_returning(_json_facts(settings, facts))
    extractor = CallerFactExtractor(settings, client)  # type: ignore[arg-type]
    parsed = extractor.extract(
        history=[],
        user_turn=user_turn,
        persona_reply=persona_reply,
    )
    messages = captured["messages"]
    assert isinstance(messages, list)
    payload = json.loads(messages[1]["content"])
    assert payload[settings.caller_fact_payload_user_turn_key] == user_turn
    assert payload[settings.caller_fact_payload_persona_reply_key] == persona_reply
    reason = (
        settings.caller_fact_reason_extracted
        if facts
        else settings.caller_fact_reason_empty
    )
    assert parsed == CallerFactExtract(facts, reason)


def test_parse_discards_a_fact_without_the_third_person_prefix(
    settings: WorkerSettings,
) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    parsed = extractor.parse(
        _json_facts(settings, ["Lives in Pune.", "The caller sails."]),
    )
    assert parsed.facts == ["The caller sails."]
    assert parsed.reason == settings.caller_fact_reason_extracted


def test_parse_all_facts_malformed_is_unrecognised_not_empty(
    settings: WorkerSettings,
) -> None:
    """A dropped-to-nothing pass must retry, not read as an honest empty."""
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    parsed = extractor.parse(_json_facts(settings, ["I live in Pune."]))
    assert parsed.facts == []
    assert parsed.reason == settings.caller_fact_reason_unrecognised


def test_per_turn_prompt_extracts_the_newest_exchange_only() -> None:
    prompt = DEFAULT_CALLER_FACT_SYSTEM_PROMPT
    assert "newest exchange" in prompt
    assert "Extract only from {user_turn_key} and {persona_reply_key}" in prompt
    assert "has been recorded" in prompt
    assert "{history_key} only to understand" in prompt


def test_closing_prompt_is_the_whole_sitting_safety_net() -> None:
    prompt = DEFAULT_CALLER_FACT_CLOSING_SYSTEM_PROMPT
    assert "already extracted on its own" in prompt
    assert "Do not restate a fact that one exchange stated plainly" in prompt
    assert "only what held at the end" in prompt
    assert 'must start with "{fact_prefix}"' in prompt


def test_messages_pick_the_brief_that_matches_the_pass(
    settings: WorkerSettings,
) -> None:
    extractor = CallerFactExtractor(settings, _DummyClient())  # type: ignore[arg-type]
    per_turn = extractor._messages(
        history=[],
        user_turn="I live in Pune",
        persona_reply="good to know",
    )
    closing = extractor._messages(
        history=[],
        user_turn="I live in Pune",
        persona_reply="good to know",
        closing=True,
    )
    assert "newest exchange" in per_turn[0]["content"]
    assert "newest exchange" not in closing[0]["content"]
    assert "already extracted on its own" in closing[0]["content"]


def test_stamp_carries_the_date_into_the_written_row(
    settings: WorkerSettings,
) -> None:
    stated = datetime(2026, 9, 17, tzinfo=UTC)
    assert (
        stamp_caller_fact("The caller sails.", settings, now=stated)
        == "The caller sails. (stated 2026-09-17)"
    )
    off = settings.model_copy(update={"caller_fact_stamp_enabled": False})
    assert stamp_caller_fact("The caller sails.", off, now=stated) == (
        "The caller sails."
    )
