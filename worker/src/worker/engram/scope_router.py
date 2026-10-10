from __future__ import annotations

import json
from dataclasses import dataclass

from openai import APITimeoutError, OpenAI, OpenAIError

from worker.config import WorkerSettings
from worker.engram.scope_defaults import (
    DEFAULT_SCOPE_ROUTER_SYSTEM_PROMPT,
    render_scope_router_prompt,
)


@dataclass(frozen=True)
class ScopeDecision:
    scope: str
    reason: str


class ScopeRouter:
    """Structured pool choice for one turn. Never inspects the utterance.

    The decision is a model output or it does not happen. Timeout, error, or
    an unrecognised value falls open to both pools with a reason code.
    """

    def __init__(
        self,
        settings: WorkerSettings,
        client: OpenAI | None = None,
    ) -> None:
        self._settings = settings
        self._client = client

    def decide(self, question: str) -> ScopeDecision:
        both = self._fail_open()
        if self._client is None:
            return both
        model = self._settings.engram_scope_router_model or self._settings.openai_model
        if not model:
            return both
        try:
            completion = self._client.chat.completions.create(
                model=model,
                messages=self._messages(question),
                temperature=self._settings.engram_scope_router_temperature,
                max_completion_tokens=self._settings.engram_scope_router_max_tokens,
                timeout=self._settings.engram_scope_router_timeout_seconds,
                response_format={
                    "type": self._settings.engram_scope_router_response_format_type,
                },
            )
        except APITimeoutError:
            return ScopeDecision(
                self._settings.engram_retrieve_scope_both,
                self._settings.engram_scope_router_reason_timeout,
            )
        except OpenAIError:
            return both
        except Exception:  # noqa: BLE001 - fail open; never starve a turn
            return both
        content = ""
        if completion.choices:
            raw = completion.choices[0].message.content
            if isinstance(raw, str):
                content = raw
        return self.parse(content)

    def parse(self, content: str) -> ScopeDecision:
        both = self._settings.engram_retrieve_scope_both
        unrecognised = self._settings.engram_scope_router_reason_unrecognised
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            return ScopeDecision(both, unrecognised)
        if not isinstance(payload, dict):
            return ScopeDecision(both, unrecognised)
        scope = payload.get(self._settings.engram_scope_router_scope_key)
        reason = payload.get(self._settings.engram_scope_router_reason_key)
        if not isinstance(scope, str):
            return ScopeDecision(both, unrecognised)
        chosen = self._canonical_scope(scope)
        if chosen is None:
            return ScopeDecision(both, unrecognised)
        if isinstance(reason, str) and reason in self._model_reasons():
            return ScopeDecision(chosen, reason)
        return ScopeDecision(chosen, self._reason_for_scope(chosen))

    def _canonical_scope(self, scope: str) -> str | None:
        allowed = {
            self._settings.engram_retrieve_scope_shared,
            self._settings.engram_retrieve_scope_private,
            self._settings.engram_retrieve_scope_both,
        }
        if scope in allowed:
            return scope
        return None

    def _reason_for_scope(self, scope: str) -> str:
        settings = self._settings
        if scope == settings.engram_retrieve_scope_shared:
            return settings.engram_scope_router_reason_shared
        if scope == settings.engram_retrieve_scope_private:
            return settings.engram_scope_router_reason_private
        return settings.engram_scope_router_reason_both

    def _model_reasons(self) -> set[str]:
        settings = self._settings
        return {
            settings.engram_scope_router_reason_shared,
            settings.engram_scope_router_reason_private,
            settings.engram_scope_router_reason_both,
        }

    def _fail_open(self) -> ScopeDecision:
        return ScopeDecision(
            self._settings.engram_retrieve_scope_both,
            self._settings.engram_scope_router_reason_error,
        )

    def _messages(self, question: str) -> list[dict[str, str]]:
        settings = self._settings
        template = (
            settings.engram_scope_router_system_prompt
            or DEFAULT_SCOPE_ROUTER_SYSTEM_PROMPT
        )
        system = render_scope_router_prompt(
            template,
            {
                "question_key": settings.engram_scope_router_question_key,
                "scope_key": settings.engram_scope_router_scope_key,
                "reason_key": settings.engram_scope_router_reason_key,
                "scope_shared": settings.engram_retrieve_scope_shared,
                "scope_private": settings.engram_retrieve_scope_private,
                "scope_both": settings.engram_retrieve_scope_both,
                "reason_shared": settings.engram_scope_router_reason_shared,
                "reason_private": settings.engram_scope_router_reason_private,
                "reason_both": settings.engram_scope_router_reason_both,
            },
        )
        payload = json.dumps(
            {settings.engram_scope_router_question_key: question},
            ensure_ascii=False,
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": payload},
        ]
