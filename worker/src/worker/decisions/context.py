from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from worker.config import WorkerSettings
from worker.reframe.types import HistoryTurn


@dataclass(frozen=True)
class DecisionContext:
    question: str
    history: tuple[HistoryTurn, ...] = ()
    # These fields come from the validated catalog/sitting, never request history.
    persona_identity: tuple[tuple[str, str], ...] = ()
    app_state: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_turn(
        cls,
        question: str,
        history: list[HistoryTurn],
        persona_identity: dict[str, Any],
        settings: WorkerSettings,
    ) -> DecisionContext:
        return cls(
            question,
            tuple(history),
            tuple(
                (key, value)
                for key in (
                    settings.persona_identity_name_key,
                    settings.persona_identity_description_key,
                )
                if isinstance(value := persona_identity.get(key), str)
            ),
            (("brain_mode", settings.brain_mode),),
        )

    def serialize(self, settings: WorkerSettings) -> str | None:
        count = settings.decisions_history_turns
        history = list(self.history[-count:]) if count else []
        while True:
            payload = json.dumps(
                {
                    settings.engram_scope_router_question_key: self.question,
                    settings.decisions_context_history_key: [
                        {"speaker": turn.speaker, "text": turn.text} for turn in history
                    ],
                    settings.decisions_context_identity_key: dict(
                        self.persona_identity,
                    ),
                    settings.decisions_context_state_key: dict(self.app_state),
                },
                ensure_ascii=False,
            )
            if len(payload.encode("utf-8")) <= settings.decisions_input_max_bytes:
                return payload
            if not history:
                return None
            history.pop(0)
