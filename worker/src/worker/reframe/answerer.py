from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from openai import OpenAI, OpenAIError

from worker.clients import create_openai
from worker.config import WorkerSettings
from worker.reframe.defaults import DEFAULT_ANSWER_SYSTEM_PROMPT
from worker.reframe.errors import (
    ReframeEmptyInputError,
    ReframeEmptyOutputError,
    ReframeError,
    ReframeUnavailableError,
)
from worker.reframe.reframer import translate_openai_error
from worker.reframe.types import HistoryTurn


def _kept(items: list[str]) -> list[str]:
    return [item for item in items if isinstance(item, str) and item.strip()]


def _with_current_turn(
    history: list[HistoryTurn],
    question: str,
    *,
    speaker: str,
    limit: int,
) -> list[HistoryTurn]:
    """This sitting includes what they just said. Limit 0 keeps history empty."""
    if limit <= 0:
        return []
    recent = history[-limit:]
    current = HistoryTurn(speaker=speaker, text=question.strip())
    if (
        recent
        and recent[-1].speaker == current.speaker
        and recent[-1].text == current.text
    ):
        return recent
    return [*recent, current][-limit:]


def _payload(
    settings: WorkerSettings,
    persona_memories: list[str],
    caller_memories: list[str],
    persona_identity: dict[str, Any],
    history: list[HistoryTurn],
    question: str,
    voice_config: dict[str, Any],
) -> str:
    return json.dumps(
        {
            settings.answer_payload_persona_memories_key: persona_memories,
            settings.answer_payload_caller_memories_key: caller_memories,
            settings.answer_payload_persona_identity_key: persona_identity,
            settings.answer_payload_history_key: [
                {"speaker": turn.speaker, "text": turn.text} for turn in history
            ],
            settings.answer_payload_question_key: question,
            settings.answer_payload_voice_config_key: voice_config,
        },
        ensure_ascii=False,
    )


class Answerer:
    """Speaks as the persona from memories retrieved for this turn.

    Used when the brain reads memory and composes the reply here rather than
    asking the memory service to compose it. Long-term facts come from
    persona_identity and the two labelled lists. This sitting's speaker-labelled
    history is this-call context, not those lists. The current question is
    included in that window so a same-call correction is sitting context.
    """

    def __init__(
        self,
        settings: WorkerSettings,
        client: OpenAI | None = None,
    ) -> None:
        self._settings = settings
        if client is not None:
            self._client = client
            return
        try:
            self._client = create_openai(settings)
        except RuntimeError as exc:
            raise ReframeUnavailableError(str(exc)) from exc

    def _request(
        self,
        *,
        persona_memories: list[str],
        caller_memories: list[str],
        persona_identity: dict[str, Any],
        history: list[HistoryTurn],
        question: str,
        voice_config: dict[str, Any],
    ) -> tuple[str, list[dict[str, str]]]:
        persona = _kept(persona_memories)
        caller = _kept(caller_memories)
        if not isinstance(question, str) or not question.strip():
            raise ReframeEmptyInputError("answering requires a question")
        if not isinstance(voice_config, dict):
            raise ReframeError("voice_config must be an object")
        if not isinstance(persona_identity, dict):
            raise ReframeError("persona_identity must be an object")

        limit = self._settings.reframe_history_turns
        recent = _with_current_turn(
            history,
            question,
            speaker=self._settings.engram_converse_user_speaker,
            limit=limit,
        )
        system = self._settings.answer_system_prompt or DEFAULT_ANSWER_SYSTEM_PROMPT
        model = self._settings.openai_model
        if not model:
            raise ReframeUnavailableError("OPENAI_MODEL is not set")
        return model, [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": _payload(
                    self._settings,
                    persona,
                    caller,
                    persona_identity,
                    recent,
                    question,
                    voice_config,
                ),
            },
        ]

    def answer(
        self,
        *,
        persona_memories: list[str],
        caller_memories: list[str],
        persona_identity: dict[str, Any],
        history: list[HistoryTurn],
        question: str,
        voice_config: dict[str, Any],
    ) -> str:
        model, request = self._request(
            persona_memories=persona_memories,
            caller_memories=caller_memories,
            persona_identity=persona_identity,
            history=history,
            question=question,
            voice_config=voice_config,
        )
        try:
            completion = self._client.chat.completions.create(
                model=model,
                messages=request,
                temperature=self._settings.answer_temperature,
                max_completion_tokens=self._settings.answer_max_tokens,
                timeout=self._settings.reframe_timeout_seconds,
            )
        except OpenAIError as exc:
            raise translate_openai_error(exc) from exc

        spoken = ""
        if completion.choices:
            content = completion.choices[0].message.content
            if isinstance(content, str):
                spoken = content.strip()
        if not spoken:
            raise ReframeEmptyOutputError("answer model returned no text")
        return spoken

    def stream(
        self,
        *,
        persona_memories: list[str],
        caller_memories: list[str],
        persona_identity: dict[str, Any],
        history: list[HistoryTurn],
        question: str,
        voice_config: dict[str, Any],
    ) -> Iterator[str]:
        model, request = self._request(
            persona_memories=persona_memories,
            caller_memories=caller_memories,
            persona_identity=persona_identity,
            history=history,
            question=question,
            voice_config=voice_config,
        )
        try:
            stream = self._client.chat.completions.create(
                model=model,
                messages=request,
                temperature=self._settings.answer_temperature,
                max_completion_tokens=self._settings.answer_max_tokens,
                timeout=self._settings.reframe_timeout_seconds,
                stream=True,
            )
            emitted = False
            for chunk in stream:
                if not chunk.choices:
                    continue
                piece = getattr(chunk.choices[0].delta, "content", None)
                if isinstance(piece, str) and piece:
                    emitted = True
                    yield piece
        except OpenAIError as exc:
            raise translate_openai_error(exc) from exc
        if not emitted:
            raise ReframeEmptyOutputError("answer model returned no text")
