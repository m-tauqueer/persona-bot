from __future__ import annotations

from dataclasses import dataclass

from worker.config import WorkerSettings
from worker.decisions.types import ChoiceQuestion, ChoiceResult


@dataclass(frozen=True)
class ConversationDecision:
    mode: str
    reason: str
    requested: str | None = None
    confidence: float | None = None


def conversation_question(settings: WorkerSettings) -> ChoiceQuestion:
    return ChoiceQuestion(
        settings.conversation_decisions_question_name,
        settings.conversation_decisions_instructions,
        (
            (
                settings.conversation_decisions_answer_value,
                settings.conversation_decisions_answer_description,
            ),
            (
                settings.conversation_decisions_acknowledge_value,
                settings.conversation_decisions_acknowledge_description,
            ),
        ),
    )


def conversation_decision(
    result: ChoiceResult | None,
    settings: WorkerSettings,
    *,
    speak_eligible: bool = True,
) -> ConversationDecision:
    answer = settings.conversation_decisions_answer_value
    reasons = {
        "timeout": settings.conversation_decisions_reason_timeout,
        "refusal": settings.conversation_decisions_reason_refusal,
        "malformed": settings.conversation_decisions_reason_malformed,
        "unavailable": settings.conversation_decisions_reason_error,
        "saturated": settings.conversation_decisions_reason_saturated,
        "input_too_large": settings.conversation_decisions_reason_input_too_large,
    }
    if not speak_eligible:
        reason = settings.conversation_decisions_reason_ineligible
    elif settings.brain_mode == "chat":
        reason = settings.conversation_decisions_reason_chat
    elif settings.conversation_decisions_mode == "off":
        reason = settings.conversation_decisions_reason_disabled
    elif result is None:
        reason = (
            settings.conversation_decisions_reason_shadow
            if settings.conversation_decisions_mode == "shadow"
            else settings.conversation_decisions_reason_disabled
        )
    elif result.outcome != "success":
        reason = reasons[result.outcome]
    elif result.choice not in {
        answer,
        settings.conversation_decisions_acknowledge_value,
    }:
        reason = settings.conversation_decisions_reason_malformed
    elif settings.conversation_decisions_mode == "shadow":
        reason = settings.conversation_decisions_reason_shadow
    elif result.choice == answer:
        reason = settings.conversation_decisions_reason_answer
    elif (
        result.confidence is None
        or settings.conversation_decisions_min_confidence is None
        or result.confidence < settings.conversation_decisions_min_confidence
    ):
        reason = settings.conversation_decisions_reason_low_confidence
    else:
        return ConversationDecision(
            settings.conversation_decisions_acknowledge_value,
            settings.conversation_decisions_reason_acknowledge,
            result.choice,
            result.confidence,
        )
    return ConversationDecision(
        answer,
        reason,
        result.choice if result else None,
        result.confidence if result else None,
    )
