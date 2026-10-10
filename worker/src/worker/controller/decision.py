from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Action(StrEnum):
    SPEAK = "speak"
    SILENCE = "silence"


class ReasonCode(StrEnum):
    HAS_GROUNDED_REPLY = "has_grounded_reply"
    EMPTY_REPLY = "empty_reply"
    EMPTY_CHOSEN_POOL = "empty_chosen_pool"
    EMPTY_INPUT = "empty_input"
    NOT_SUBSCRIBED = "not_subscribed"
    UNAUTHORIZED = "unauthorized"
    PAYMENT_REQUIRED = "payment_required"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    VALIDATION = "validation"
    SERVER_ERROR = "server_error"
    RETRYABLE_READ = "retryable_read"
    BRAIN_ERROR = "brain_error"


@dataclass(frozen=True)
class TurnSignals:
    has_inbound_text: bool


@dataclass(frozen=True)
class Decision:
    action: Action
    reasons: tuple[ReasonCode, ...]
    hints: dict[str, Any]
