from __future__ import annotations

from typing import Any

from worker.controller.decision import Action, Decision, ReasonCode, TurnSignals
from worker.engram.errors import (
    BrainError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    NotSubscribedError,
    PaymentRequiredError,
    RetryableReadError,
    ServerError,
    UnauthorizedError,
    ValidationError,
)
from worker.engram.interface import ChatOutcome

_ERROR_REASONS: dict[type[BrainError], ReasonCode] = {
    NotSubscribedError: ReasonCode.NOT_SUBSCRIBED,
    UnauthorizedError: ReasonCode.UNAUTHORIZED,
    PaymentRequiredError: ReasonCode.PAYMENT_REQUIRED,
    ForbiddenError: ReasonCode.FORBIDDEN,
    NotFoundError: ReasonCode.NOT_FOUND,
    ConflictError: ReasonCode.CONFLICT,
    ValidationError: ReasonCode.VALIDATION,
    ServerError: ReasonCode.SERVER_ERROR,
    RetryableReadError: ReasonCode.RETRYABLE_READ,
}


def _reason_for_error(error: BrainError) -> ReasonCode:
    for cls, reason in _ERROR_REASONS.items():
        if isinstance(error, cls):
            return reason
    return ReasonCode.BRAIN_ERROR


def _error_hints(error: BrainError) -> dict[str, Any]:
    hints: dict[str, Any] = {}
    if error.status is not None:
        hints["status"] = error.status
    return hints


def _deliverable_messages(outcome: ChatOutcome) -> list[str]:
    return [
        item
        for item in outcome.messages
        if isinstance(item, str) and item.strip()
    ]


def _outcome_hints(outcome: ChatOutcome, bubbles: list[str]) -> dict[str, Any]:
    return {
        "message_count": len(bubbles),
        "memories_used_count": len(outcome.memories_used),
        "has_session_id": bool(outcome.session_id),
    }


class Controller:
    def pre(self, signals: TurnSignals) -> Decision | None:
        """Halt before chat when inbound text is structurally absent."""
        if not signals.has_inbound_text:
            return Decision(Action.SILENCE, (ReasonCode.EMPTY_INPUT,), {})
        return None

    def decide(
        self,
        outcome: ChatOutcome | BrainError,
        signals: TurnSignals,
    ) -> Decision:
        halted = self.pre(signals)
        if halted is not None:
            return halted
        if isinstance(outcome, BrainError):
            return Decision(
                Action.SILENCE,
                (_reason_for_error(outcome),),
                _error_hints(outcome),
            )
        bubbles = _deliverable_messages(outcome)
        hints = _outcome_hints(outcome, bubbles)
        if bubbles:
            return Decision(
                Action.SPEAK,
                (ReasonCode.HAS_GROUNDED_REPLY,),
                hints,
            )
        return Decision(Action.SILENCE, (ReasonCode.EMPTY_REPLY,), hints)
