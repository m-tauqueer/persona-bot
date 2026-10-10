from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ChoiceOutcome = Literal[
    "success",
    "timeout",
    "refusal",
    "malformed",
    "unavailable",
    "saturated",
    "input_too_large",
]


@dataclass(frozen=True)
class ChoiceQuestion:
    name: str
    instructions: str
    choices: tuple[tuple[str, str], ...]

    def wire(self) -> dict:
        return {
            "type": "choice",
            "name": self.name,
            "instructions": self.instructions,
            "choices": [
                {"value": value, "description": description}
                for value, description in self.choices
            ],
        }


@dataclass(frozen=True)
class ChoiceResult:
    name: str
    outcome: ChoiceOutcome
    choice: str | None = None
    confidence: float | None = None
    probabilities: tuple[tuple[str, float], ...] = ()


@dataclass(frozen=True)
class DecisionBundle:
    answers: tuple[ChoiceResult, ...]
    duration_ms: float

    def answer(self, name: str) -> ChoiceResult:
        return next(
            (answer for answer in self.answers if answer.name == name),
            ChoiceResult(name, "malformed"),
        )
