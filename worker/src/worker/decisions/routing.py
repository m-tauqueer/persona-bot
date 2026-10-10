from __future__ import annotations

from worker.config import WorkerSettings
from worker.decisions.types import ChoiceResult
from worker.engram.scope_router import ScopeDecision


def scope_decision(result: ChoiceResult, settings: WorkerSettings) -> ScopeDecision:
    """A classifier may only discard an authorized list, never admit memory."""
    both = settings.engram_retrieve_scope_both
    failures = {
        "timeout": settings.engram_scope_router_reason_timeout,
        "refusal": settings.decisions_reason_refusal,
        "malformed": settings.engram_scope_router_reason_unrecognised,
        "unavailable": settings.engram_scope_router_reason_error,
        "saturated": settings.decisions_reason_saturated,
        "input_too_large": settings.decisions_reason_input_too_large,
    }
    if result.outcome != "success":
        return ScopeDecision(both, failures[result.outcome])
    reasons = {
        settings.engram_retrieve_scope_shared: (
            settings.engram_scope_router_reason_shared
        ),
        settings.engram_retrieve_scope_private: (
            settings.engram_scope_router_reason_private
        ),
        both: settings.engram_scope_router_reason_both,
    }
    if result.choice not in reasons or result.confidence is None:
        return ScopeDecision(both, settings.engram_scope_router_reason_unrecognised)
    threshold = settings.decisions_scope_min_confidence
    if threshold is None or result.confidence < threshold:
        return ScopeDecision(both, settings.decisions_reason_low_confidence)
    return ScopeDecision(result.choice, reasons[result.choice])
