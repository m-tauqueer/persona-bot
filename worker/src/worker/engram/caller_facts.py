from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime

from openai import APITimeoutError, OpenAI, OpenAIError

from worker.config import WorkerSettings
from worker.engram.caller_fact_defaults import (
    DEFAULT_CALLER_FACT_CLOSING_SYSTEM_PROMPT,
    DEFAULT_CALLER_FACT_SYSTEM_PROMPT,
    render_caller_fact_prompt,
)
from worker.reframe.types import HistoryTurn


@dataclass(frozen=True)
class CallerFactExtract:
    facts: list[str]
    reason: str


def stamp_caller_fact(
    fact: str,
    settings: WorkerSettings,
    *,
    now: datetime | None = None,
) -> str:
    """Date the fact as it is written.

    The private pool is append-only: a later sitting cannot retract what an
    earlier one stored. Carrying the date in the row itself is what lets the
    answerer prefer the newer of two conflicting caller memories.
    """
    if not settings.caller_fact_stamp_enabled:
        return fact
    when = now if now is not None else datetime.now(tz=UTC)
    stamp = settings.caller_fact_stamp_template.replace(
        "{date}",
        when.strftime(settings.caller_fact_stamp_date_format),
    )
    return f"{fact}{stamp}"


class CallerFactExtractor:
    """Structured caller facts from a sitting window. Never inspects the text.

    The decision is a model output or it does not happen. Timeout, error, or
    an unrecognised value writes nothing (fail closed on this pass).
    An empty list is success.
    """

    def __init__(
        self,
        settings: WorkerSettings,
        client: OpenAI | None = None,
    ) -> None:
        self._settings = settings
        self._client = client

    def extract(
        self,
        *,
        history: list[HistoryTurn],
        user_turn: str,
        persona_reply: str,
        history_limit: int | None = None,
        closing: bool = False,
    ) -> CallerFactExtract:
        closed = self._fail_closed()
        if self._client is None:
            return closed
        model = self._settings.caller_fact_model or self._settings.openai_model
        if not model:
            return closed
        try:
            completion = self._client.chat.completions.create(
                model=model,
                messages=self._messages(
                    history=history,
                    user_turn=user_turn,
                    persona_reply=persona_reply,
                    history_limit=history_limit,
                    closing=closing,
                ),
                temperature=self._settings.caller_fact_temperature,
                max_completion_tokens=self._settings.caller_fact_max_tokens,
                timeout=self._settings.caller_fact_timeout_seconds,
                response_format={
                    "type": self._settings.caller_fact_response_format_type,
                },
            )
        except APITimeoutError:
            return CallerFactExtract(
                [],
                self._settings.caller_fact_reason_timeout,
            )
        except OpenAIError:
            return closed
        except Exception:  # noqa: BLE001 - fail closed; never dump the sitting
            return closed
        content = ""
        if completion.choices:
            raw = completion.choices[0].message.content
            if isinstance(raw, str):
                content = raw
        return self.parse(content)

    def parse(self, content: str) -> CallerFactExtract:
        unrecognised = self._settings.caller_fact_reason_unrecognised
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            return CallerFactExtract([], unrecognised)
        if not isinstance(payload, dict):
            return CallerFactExtract([], unrecognised)
        raw_facts = payload.get(self._settings.caller_fact_payload_facts_key)
        if not isinstance(raw_facts, list):
            return CallerFactExtract([], unrecognised)
        facts: list[str] = []
        cap = self._settings.caller_fact_max_facts
        prefix = self._settings.caller_fact_prefix.strip().casefold()
        malformed = 0
        for item in raw_facts:
            if len(facts) >= cap:
                break
            if not isinstance(item, str) or not item.strip():
                continue
            text = item.strip()
            # A row without the third-person prefix reads like persona speech
            # once it is retrieved. Never let one into the private pool.
            if prefix and not text.casefold().startswith(prefix):
                malformed += 1
                continue
            facts.append(text)
        if not facts:
            if malformed:
                return CallerFactExtract([], unrecognised)
            return CallerFactExtract(
                [],
                self._settings.caller_fact_reason_empty,
            )
        return CallerFactExtract(
            facts,
            self._settings.caller_fact_reason_extracted,
        )

    def _fail_closed(self) -> CallerFactExtract:
        return CallerFactExtract(
            [],
            self._settings.caller_fact_reason_error,
        )

    def _messages(
        self,
        *,
        history: list[HistoryTurn],
        user_turn: str,
        persona_reply: str,
        history_limit: int | None = None,
        closing: bool = False,
    ) -> list[dict[str, str]]:
        settings = self._settings
        if closing:
            template = (
                settings.caller_fact_closing_system_prompt
                or DEFAULT_CALLER_FACT_CLOSING_SYSTEM_PROMPT
            )
        else:
            template = (
                settings.caller_fact_system_prompt or DEFAULT_CALLER_FACT_SYSTEM_PROMPT
            )
        system = render_caller_fact_prompt(
            template,
            {
                "history_key": settings.caller_fact_payload_history_key,
                "user_turn_key": settings.caller_fact_payload_user_turn_key,
                "persona_reply_key": settings.caller_fact_payload_persona_reply_key,
                "facts_key": settings.caller_fact_payload_facts_key,
                "speaker_key": settings.caller_fact_payload_speaker_key,
                "text_key": settings.caller_fact_payload_text_key,
                "fact_prefix": settings.caller_fact_prefix,
            },
        )
        limit = (
            settings.reframe_history_turns
            if history_limit is None
            else history_limit
        )
        recent = history[-limit:] if limit > 0 else []
        payload = json.dumps(
            {
                settings.caller_fact_payload_history_key: [
                    {
                        settings.caller_fact_payload_speaker_key: turn.speaker,
                        settings.caller_fact_payload_text_key: turn.text,
                    }
                    for turn in recent
                ],
                settings.caller_fact_payload_user_turn_key: user_turn,
                settings.caller_fact_payload_persona_reply_key: persona_reply,
            },
            ensure_ascii=False,
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": payload},
        ]
