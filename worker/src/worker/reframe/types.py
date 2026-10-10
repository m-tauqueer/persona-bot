from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HistoryTurn:
    speaker: str
    text: str
