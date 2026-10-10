import json
from types import SimpleNamespace

import httpx
import pytest
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAIError,
)

from worker.config import WorkerSettings
from worker.reframe.answerer import Answerer
from worker.reframe.defaults import (
    DEFAULT_ANSWER_SYSTEM_PROMPT,
    DEFAULT_REFRAME_SYSTEM_PROMPT,
)
from worker.reframe.errors import (
    ReframeEmptyInputError,
    ReframeEmptyOutputError,
    ReframeError,
    ReframeUnavailableError,
)
from worker.reframe.reframer import Reframer, translate_openai_error
from worker.reframe.types import HistoryTurn


class DummyClient:
    pass


def test_reframe_request_uses_fact_lock_prompt(settings: WorkerSettings) -> None:
    reframer = Reframer(settings, DummyClient())
    model, messages = reframer._request(
        ["I kept a diary by the Thames."],
        [HistoryTurn(speaker="user", text="What did you keep?")],
        {"pace": "calm"},
    )
    assert model == settings.openai_model
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == DEFAULT_REFRAME_SYSTEM_PROMPT
    assert "Make it crisp" in messages[0]["content"]
    payload = json.loads(messages[1]["content"])
    assert set(payload.keys()) == {"messages", "history", "voice_config"}
    assert payload["messages"] == ["I kept a diary by the Thames."]
    assert payload["history"] == [
        {"speaker": "user", "text": "What did you keep?"},
    ]
    assert payload["voice_config"] == {"pace": "calm"}


def test_reframe_uses_configured_prompt(settings: WorkerSettings) -> None:
    settings.reframe_system_prompt = "configured fact lock"
    reframer = Reframer(settings, DummyClient())
    _, messages = reframer._request(["fact"], [], {})
    assert messages[0]["content"] == "configured fact lock"


def test_reframe_rejects_empty_messages(settings: WorkerSettings) -> None:
    reframer = Reframer(settings, DummyClient())
    with pytest.raises(ReframeEmptyInputError):
        reframer._request(["", "  "], [], {})


def test_answer_request_keeps_labelled_lists_and_sitting_history(
    settings: WorkerSettings,
) -> None:
    answerer = Answerer(settings, DummyClient())
    _, messages = answerer._request(
        persona_memories=["I taught in Oxford."],
        caller_memories=["They sail."],
        history=[HistoryTurn(speaker="user", text="Where did you teach?")],
        question="Where did you teach?",
        persona_identity={},
        voice_config={},
    )
    assert messages[0]["content"] == DEFAULT_ANSWER_SYSTEM_PROMPT
    payload = json.loads(messages[1]["content"])
    assert set(payload.keys()) == {
        settings.answer_payload_persona_memories_key,
        settings.answer_payload_caller_memories_key,
        settings.answer_payload_persona_identity_key,
        settings.answer_payload_history_key,
        settings.answer_payload_question_key,
        settings.answer_payload_voice_config_key,
    }
    assert payload[settings.answer_payload_persona_memories_key] == [
        "I taught in Oxford.",
    ]
    assert payload[settings.answer_payload_caller_memories_key] == ["They sail."]
    assert payload[settings.answer_payload_history_key] == [
        {"speaker": "user", "text": "Where did you teach?"},
    ]
    assert payload[settings.answer_payload_question_key] == "Where did you teach?"
    assert "Where did you teach?" not in payload[
        settings.answer_payload_persona_memories_key
    ]
    assert "Where did you teach?" not in payload[
        settings.answer_payload_caller_memories_key
    ]


def test_answer_prompt_does_not_treat_coverage_as_the_persona_job() -> None:
    prompt = DEFAULT_ANSWER_SYSTEM_PROMPT
    assert "recalling their own work" not in prompt
    assert "Knowledge of an organization is not a claim" in prompt
    assert "Never speak caller_memories in the first person as yourself" in prompt
    assert "First-person fragments in memories may be quotes" in prompt
    assert "Say they and their, not we and our" in prompt
    assert "They are not employers you join" in prompt
    assert "the correction wins" in prompt
    assert "Do not restore the unsay from caller_memories" in prompt
    assert "treat the question as current" in prompt
    assert "outranks caller_memories" in prompt
    assert "Do not swap it for a different one" in prompt
    assert "believe the question" in prompt
    assert "Using them is not inventing a long-term fact" in prompt
    assert "Make it crisp" in prompt
    assert "Leave every other memory unsaid" in prompt


def test_answer_history_length_follows_config(settings: WorkerSettings) -> None:
    loaded = settings.model_copy(update={"reframe_history_turns": 2})
    answerer = Answerer(loaded, DummyClient())
    history = [
        HistoryTurn(speaker="user", text="one"),
        HistoryTurn(speaker="persona", text="two"),
        HistoryTurn(speaker="user", text="three"),
        HistoryTurn(speaker="persona", text="four"),
    ]
    _, messages = answerer._request(
        persona_memories=["persona fact"],
        caller_memories=["caller fact"],
        history=history,
        question="what did I just say",
        persona_identity={},
        voice_config={},
    )
    payload = json.loads(messages[1]["content"])
    assert payload[loaded.answer_payload_history_key] == [
        {"speaker": "persona", "text": "four"},
        {"speaker": loaded.engram_converse_user_speaker, "text": "what did I just say"},
    ]
    assert payload[loaded.answer_payload_persona_memories_key] == ["persona fact"]
    assert payload[loaded.answer_payload_caller_memories_key] == ["caller fact"]
    empty = loaded.model_copy(update={"reframe_history_turns": 0})
    _, none = Answerer(empty, DummyClient())._request(
        persona_memories=["persona fact"],
        caller_memories=["caller fact"],
        history=history,
        question="what did I just say",
        persona_identity={},
        voice_config={},
    )
    none_payload = json.loads(none[1]["content"])
    assert none_payload[empty.answer_payload_history_key] == []
    assert none_payload[empty.answer_payload_persona_memories_key] == ["persona fact"]
    assert none_payload[empty.answer_payload_caller_memories_key] == ["caller fact"]


def test_answer_history_includes_the_current_question(
    settings: WorkerSettings,
) -> None:
    answerer = Answerer(settings, DummyClient())
    said = "I sail on Tuesdays"
    _, messages = answerer._request(
        persona_memories=["persona fact"],
        caller_memories=["caller fact"],
        history=[HistoryTurn(speaker="persona", text="hello")],
        question=said,
        persona_identity={},
        voice_config={},
    )
    payload = json.loads(messages[1]["content"])
    assert payload[settings.answer_payload_history_key] == [
        {"speaker": "persona", "text": "hello"},
        {
            "speaker": settings.engram_converse_user_speaker,
            "text": said,
        },
    ]
    already = [
        HistoryTurn(
            speaker=settings.engram_converse_user_speaker,
            text=said,
        ),
    ]
    _, again = answerer._request(
        persona_memories=["persona fact"],
        caller_memories=["caller fact"],
        history=already,
        question=said,
        persona_identity={},
        voice_config={},
    )
    again_payload = json.loads(again[1]["content"])
    assert again_payload[settings.answer_payload_history_key] == [
        {
            "speaker": settings.engram_converse_user_speaker,
            "text": said,
        },
    ]


def test_answer_allows_both_lists_empty_when_the_question_is_present(
    settings: WorkerSettings,
) -> None:
    answerer = Answerer(settings, DummyClient())
    _, messages = answerer._request(
        persona_memories=[],
        caller_memories=["", "  "],
        history=[],
        question="hello",
        persona_identity={},
        voice_config={},
    )
    payload = json.loads(messages[1]["content"])
    assert payload[settings.answer_payload_persona_memories_key] == []
    assert payload[settings.answer_payload_caller_memories_key] == []


def test_answer_rejects_empty_question(settings: WorkerSettings) -> None:
    answerer = Answerer(settings, DummyClient())
    with pytest.raises(ReframeEmptyInputError):
        answerer._request(
            persona_memories=[],
            caller_memories=[],
            history=[],
            question="  ",
            persona_identity={},
            voice_config={},
        )


def test_answer_keeps_empty_caller_list_when_persona_has_facts(
    settings: WorkerSettings,
) -> None:
    answerer = Answerer(settings, DummyClient())
    _, messages = answerer._request(
        persona_memories=["I taught in Oxford."],
        caller_memories=[],
        history=[],
        question="hello",
        persona_identity={},
        voice_config={},
    )
    payload = json.loads(messages[1]["content"])
    assert payload[settings.answer_payload_persona_memories_key] == [
        "I taught in Oxford.",
    ]
    assert payload[settings.answer_payload_caller_memories_key] == []


def test_answer_payload_keys_come_from_config(settings: WorkerSettings) -> None:
    loaded = settings.model_copy(
        update={
            "answer_payload_persona_memories_key": "p_facts",
            "answer_payload_caller_memories_key": "c_facts",
            "answer_payload_history_key": "turns",
            "answer_payload_question_key": "ask",
            "answer_payload_voice_config_key": "voice",
            "answer_payload_persona_identity_key": "who",
        },
    )
    answerer = Answerer(loaded, DummyClient())
    _, messages = answerer._request(
        persona_memories=["persona"],
        caller_memories=["caller"],
        history=[],
        question="q",
        persona_identity={},
        voice_config={"pace": "calm"},
    )
    payload = json.loads(messages[1]["content"])
    assert set(payload.keys()) == {
        "p_facts",
        "c_facts",
        "who",
        "turns",
        "ask",
        "voice",
    }


def test_answer_payload_carries_persona_identity(
    settings: WorkerSettings,
) -> None:
    """The persona has to be told who it is; memories may never state it."""
    answerer = Answerer(settings, DummyClient())
    identity = {
        settings.persona_identity_name_key: "Caleb Friesen",
        settings.persona_identity_description_key: "A Canadian tech journalist",
    }
    _, messages = answerer._request(
        persona_memories=["Audio originated from AMA with Caleb Friesen."],
        caller_memories=[],
        history=[],
        question="What's your name?",
        persona_identity=identity,
        voice_config={},
    )
    payload = json.loads(messages[1]["content"])
    assert payload[settings.answer_payload_persona_identity_key] == identity
    assert settings.answer_payload_persona_identity_key in messages[0]["content"]


def test_answer_rejects_non_object_persona_identity(
    settings: WorkerSettings,
) -> None:
    with pytest.raises(ReframeError):
        Answerer(settings, DummyClient())._request(
            persona_memories=["fact"],
            caller_memories=[],
            history=[],
            question="q",
            persona_identity="not-an-object",  # type: ignore[arg-type]
            voice_config={},
        )


def test_translate_openai_errors() -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    unauthorized = httpx.Response(401, request=request)
    failed = httpx.Response(500, request=request)
    assert isinstance(
        translate_openai_error(
            AuthenticationError("bad key", response=unauthorized, body=None),
        ),
        ReframeUnavailableError,
    )
    assert isinstance(
        translate_openai_error(APITimeoutError(request)),
        ReframeUnavailableError,
    )
    assert isinstance(
        translate_openai_error(APIConnectionError(request=request)),
        ReframeUnavailableError,
    )
    mapped = translate_openai_error(
        APIStatusError("fail", response=failed, body=None),
    )
    assert isinstance(mapped, ReframeError)
    assert mapped.status == 500
    assert isinstance(translate_openai_error(OpenAIError("other")), ReframeError)


def test_reframe_returns_spoken_text(settings: WorkerSettings) -> None:
    class Completions:
        def create(self, **_kwargs):
            message = SimpleNamespace(content="  spoken  ")
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    spoken = Reframer(settings, client).reframe(["I kept a diary."], [], {})
    assert spoken == "spoken"


def test_reframe_empty_output(settings: WorkerSettings) -> None:
    class Completions:
        def create(self, **_kwargs):
            return SimpleNamespace(choices=[])

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    with pytest.raises(ReframeEmptyOutputError):
        Reframer(settings, client).reframe(["I kept a diary."], [], {})


def test_reframe_stream_yields_tokens(settings: WorkerSettings) -> None:
    class Completions:
        def create(self, **_kwargs):
            first = SimpleNamespace(delta=SimpleNamespace(content="Hi"))
            last = SimpleNamespace(delta=SimpleNamespace(content=" there"))
            return [
                SimpleNamespace(choices=[first]),
                SimpleNamespace(choices=[]),
                SimpleNamespace(choices=[last]),
            ]

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    spoken = "".join(Reframer(settings, client).stream(["I kept a diary."], [], {}))
    assert spoken == "Hi there"


def test_answer_returns_spoken_text(settings: WorkerSettings) -> None:
    captured: dict[str, object] = {}

    class Completions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="Oxford"))],
            )

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    spoken = Answerer(settings, client).answer(
        persona_memories=["I taught in Oxford."],
        caller_memories=[],
        history=[],
        question="Where?",
        persona_identity={},
        voice_config={},
    )
    assert spoken == "Oxford"
    assert captured["temperature"] == settings.answer_temperature

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    spoken = Answerer(settings, client).answer(
        persona_memories=["I taught in Oxford."],
        caller_memories=[],
        history=[],
        question="Where?",
        persona_identity={},
        voice_config={},
    )
    assert spoken == "Oxford"


def test_reframe_rejects_non_object_voice_config(settings: WorkerSettings) -> None:
    with pytest.raises(ReframeError):
        Reframer(settings, DummyClient())._request(["fact"], [], "not-an-object")  # type: ignore[arg-type]
