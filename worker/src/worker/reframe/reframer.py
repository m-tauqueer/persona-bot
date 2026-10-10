from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAI,
    OpenAIError,
)

from worker.clients import create_openai
from worker.config import WorkerSettings
from worker.reframe.defaults import DEFAULT_REFRAME_SYSTEM_PROMPT
from worker.reframe.errors import (
    ReframeEmptyInputError,
    ReframeEmptyOutputError,
    ReframeError,
    ReframeUnavailableError,
)
from worker.reframe.types import HistoryTurn


def _payload(
    messages: list[str],
    history: list[HistoryTurn],
    voice_config: dict[str, Any],
) -> str:
    return json.dumps(
        {
            "messages": messages,
            "history": [
                {"speaker": turn.speaker, "text": turn.text} for turn in history
            ],
            "voice_config": voice_config,
        },
        ensure_ascii=False,
    )


def translate_openai_error(exc: OpenAIError) -> ReframeError:
    if isinstance(exc, AuthenticationError):
        return ReframeUnavailableError(
            "reframe LLM rejected the API key",
            status=getattr(exc, "status_code", 401),
            detail=str(exc),
        )
    if isinstance(exc, APITimeoutError):
        return ReframeUnavailableError("reframe LLM timed out", detail=str(exc))
    if isinstance(exc, APIConnectionError):
        return ReframeUnavailableError("reframe LLM is unreachable", detail=str(exc))
    if isinstance(exc, APIStatusError):
        return ReframeError(
            "reframe LLM request failed",
            status=exc.status_code,
            detail=str(exc),
        )
    return ReframeError("reframe LLM request failed", detail=str(exc))


class Reframer:
    """Fact-locked rewrite of an Engram reply into one spoken utterance.

    One instance per process: the OpenAI client keeps its connections warm, so
    a turn pays for generation only, not for setting up the connection.
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
        messages: list[str],
        history: list[HistoryTurn],
        voice_config: dict[str, Any],
    ) -> tuple[str, list[dict[str, str]]]:
        bubbles = [item for item in messages if isinstance(item, str) and item.strip()]
        if not bubbles:
            raise ReframeEmptyInputError("reframe requires at least one Engram message")
        if not isinstance(voice_config, dict):
            raise ReframeError("voice_config must be an object")

        limit = self._settings.reframe_history_turns
        recent = history[-limit:] if limit > 0 else []
        system = self._settings.reframe_system_prompt or DEFAULT_REFRAME_SYSTEM_PROMPT
        model = self._settings.openai_model
        if not model:
            raise ReframeUnavailableError("OPENAI_MODEL is not set")
        return model, [
            {"role": "system", "content": system},
            {"role": "user", "content": _payload(bubbles, recent, voice_config)},
        ]

    def reframe(
        self,
        messages: list[str],
        history: list[HistoryTurn],
        voice_config: dict[str, Any],
    ) -> str:
        model, request = self._request(messages, history, voice_config)
        try:
            completion = self._client.chat.completions.create(
                model=model,
                messages=request,
                temperature=self._settings.reframe_temperature,
                max_completion_tokens=self._settings.reframe_max_tokens,
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
            raise ReframeEmptyOutputError("reframe LLM returned no text")
        return spoken

    def stream(
        self,
        messages: list[str],
        history: list[HistoryTurn],
        voice_config: dict[str, Any],
    ) -> Iterator[str]:
        """Yield the spoken utterance in order as the model produces it.

        Deepgram starts speaking on the first text token, so the caller must
        forward each piece as it arrives rather than buffering the whole reply.
        """
        model, request = self._request(messages, history, voice_config)
        try:
            stream = self._client.chat.completions.create(
                model=model,
                messages=request,
                temperature=self._settings.reframe_temperature,
                max_completion_tokens=self._settings.reframe_max_tokens,
                timeout=self._settings.reframe_timeout_seconds,
                stream=True,
            )
            emitted = False
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                piece = getattr(delta, "content", None)
                if isinstance(piece, str) and piece:
                    emitted = True
                    yield piece
        except OpenAIError as exc:
            raise translate_openai_error(exc) from exc
        if not emitted:
            raise ReframeEmptyOutputError("reframe LLM returned no text")
