import json
from types import SimpleNamespace

import httpx
from openai import APITimeoutError, OpenAIError

from worker.config import WorkerSettings
from worker.engram.scope_defaults import (
    DEFAULT_SCOPE_ROUTER_SYSTEM_PROMPT,
    render_scope_router_prompt,
)
from worker.engram.scope_router import ScopeDecision, ScopeRouter


class _DummyClient:
    pass


def _messages(router: ScopeRouter, question: str) -> list[dict[str, str]]:
    return router._messages(question)


def test_render_prompt_substitutes_config_tokens_only() -> None:
    rendered = render_scope_router_prompt(
        DEFAULT_SCOPE_ROUTER_SYSTEM_PROMPT,
        {
            "question_key": "ask",
            "scope_key": "pool",
            "reason_key": "why",
            "scope_shared": "shared",
            "scope_private": "private",
            "scope_both": "both",
            "reason_shared": "persona_directed",
            "reason_private": "self_directed",
            "reason_both": "ambiguous",
        },
    )
    assert "{question_key}" not in rendered
    assert "ask" in rendered
    assert "persona_directed" in rendered


def test_parse_accepts_labelled_json_and_falls_open_otherwise(
    settings: WorkerSettings,
) -> None:
    router = ScopeRouter(settings, _DummyClient())  # type: ignore[arg-type]
    shared = settings.engram_retrieve_scope_shared
    private = settings.engram_retrieve_scope_private
    both = settings.engram_retrieve_scope_both
    parsed = router.parse(
        json.dumps(
            {
                settings.engram_scope_router_scope_key: private,
                settings.engram_scope_router_reason_key: (
                    settings.engram_scope_router_reason_private
                ),
            },
        ),
    )
    assert parsed == ScopeDecision(
        private,
        settings.engram_scope_router_reason_private,
    )
    persona = router.parse(
        json.dumps(
            {
                settings.engram_scope_router_scope_key: shared,
                settings.engram_scope_router_reason_key: (
                    settings.engram_scope_router_reason_shared
                ),
            },
        ),
    )
    assert persona.scope == shared
    open_both = router.parse(json.dumps({settings.engram_scope_router_scope_key: both}))
    assert open_both.scope == both
    assert open_both.reason == settings.engram_scope_router_reason_both
    assert router.parse("not-json").scope == both
    assert router.parse("not-json").reason == (
        settings.engram_scope_router_reason_unrecognised
    )
    assert router.parse("[]").scope == both
    unknown = router.parse(
        json.dumps({settings.engram_scope_router_scope_key: "nope"}),
    )
    assert unknown.scope == both
    assert unknown.reason == settings.engram_scope_router_reason_unrecognised


def test_parse_keeps_valid_scope_when_reason_is_unknown(
    settings: WorkerSettings,
) -> None:
    router = ScopeRouter(settings, _DummyClient())  # type: ignore[arg-type]
    parsed = router.parse(
        json.dumps(
            {
                settings.engram_scope_router_scope_key: (
                    settings.engram_retrieve_scope_private
                ),
                settings.engram_scope_router_reason_key: "not-a-reason",
            },
        ),
    )
    assert parsed.scope == settings.engram_retrieve_scope_private
    assert parsed.reason == settings.engram_scope_router_reason_private


def test_messages_are_json_with_config_keys_not_utterance_rules(
    settings: WorkerSettings,
) -> None:
    router = ScopeRouter(settings, _DummyClient())  # type: ignore[arg-type]
    messages = _messages(router, "what do I do?")
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] != DEFAULT_SCOPE_ROUTER_SYSTEM_PROMPT
    assert settings.engram_retrieve_scope_private in messages[0]["content"]
    payload = json.loads(messages[1]["content"])
    assert payload == {settings.engram_scope_router_question_key: "what do I do?"}


def test_decide_falls_open_without_a_client(settings: WorkerSettings) -> None:
    router = ScopeRouter(settings, None)
    decision = router.decide("anything")
    assert decision.scope == settings.engram_retrieve_scope_both
    assert decision.reason == settings.engram_scope_router_reason_error


def test_decide_falls_open_on_timeout_and_error(settings: WorkerSettings) -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")

    class _Timeout:
        def create(self, **_kwargs):
            raise APITimeoutError(request)

    class _Boom:
        def create(self, **_kwargs):
            raise OpenAIError("nope")

    timeout = ScopeRouter(
        settings,
        SimpleNamespace(chat=SimpleNamespace(completions=_Timeout())),
    )
    timed = timeout.decide("q")
    assert timed.scope == settings.engram_retrieve_scope_both
    assert timed.reason == settings.engram_scope_router_reason_timeout
    boom = ScopeRouter(
        settings,
        SimpleNamespace(chat=SimpleNamespace(completions=_Boom())),
    )
    failed = boom.decide("q")
    assert failed.scope == settings.engram_retrieve_scope_both
    assert failed.reason == settings.engram_scope_router_reason_error


def test_decide_returns_parsed_model_json(settings: WorkerSettings) -> None:
    captured: dict[str, object] = {}

    class _Completions:
        def create(self, **kwargs):
            captured.update(kwargs)
            body = json.dumps(
                {
                    settings.engram_scope_router_scope_key: (
                        settings.engram_retrieve_scope_shared
                    ),
                    settings.engram_scope_router_reason_key: (
                        settings.engram_scope_router_reason_shared
                    ),
                },
            )
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=body))],
            )

    router = ScopeRouter(
        settings,
        SimpleNamespace(chat=SimpleNamespace(completions=_Completions())),
    )
    decision = router.decide("who are you?")
    assert decision.scope == settings.engram_retrieve_scope_shared
    assert decision.reason == settings.engram_scope_router_reason_shared
    assert captured["response_format"] == {
        "type": settings.engram_scope_router_response_format_type,
    }
    assert captured["timeout"] == settings.engram_scope_router_timeout_seconds
    assert captured["model"] == settings.openai_model
