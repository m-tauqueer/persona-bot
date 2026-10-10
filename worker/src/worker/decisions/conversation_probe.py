"""Synthetic reply-mode calibration helpers for the read-only Decisions probe."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from worker.config import WorkerSettings
from worker.decisions.client import DecisionsClient, scope_question
from worker.decisions.context import DecisionContext
from worker.decisions.conversation import conversation_question
from worker.decisions.probe import verdict
from worker.decisions.types import ChoiceResult, DecisionBundle
from worker.reframe.types import HistoryTurn


def load_reply_cases(path: Path, settings: WorkerSettings) -> list[dict]:
    cases = json.loads(path.read_text(encoding="utf-8"))
    reply_values = {v for v, _ in conversation_question(settings).choices}
    scope_values = {v for v, _ in scope_question(settings).choices}
    if not isinstance(cases, list) or not cases:
        raise ValueError("fixture must be a nonempty list")
    ids = set()
    for case in cases:
        if (
            not isinstance(case, dict)
            or not isinstance(case.get("id"), str)
            or case["id"] in ids
            or not isinstance(case.get("question"), str)
            or case.get("expected_reply") not in reply_values
            or case.get("expected_scope") not in scope_values
            or not isinstance(case.get("persona_identity"), dict)
            or not isinstance(case.get("history"), list)
        ):
            raise ValueError("invalid reply case")
        ids.add(case["id"])
        if any(
            not isinstance(turn, dict)
            or not isinstance(turn.get("speaker"), str)
            or not isinstance(turn.get("text"), str)
            for turn in case["history"]
        ):
            raise ValueError("invalid history")
    return cases


def reply_verdict(
    result: ChoiceResult,
    expected: str,
    settings: WorkerSettings,
    threshold: float | None,
) -> str:
    choice = result.choice
    if (
        result.outcome != "success"
        or result.confidence is None
        or (threshold is not None and result.confidence < threshold)
    ):
        choice = settings.conversation_decisions_answer_value
    if choice == expected:
        return "reply_match"
    if choice == settings.conversation_decisions_answer_value:
        return "conservative_answer"
    return "unanswered_request"


def run_reply_probe(
    settings: WorkerSettings,
    cases: list[dict],
    api: DecisionsClient,
    *,
    include_scope: bool,
    scope_threshold: float | None,
    reply_threshold: float | None,
) -> dict:
    questions = (
        (scope_question(settings), conversation_question(settings))
        if include_scope
        else (conversation_question(settings),)
    )
    counts: Counter[str] = Counter()
    outcomes: Counter[str] = Counter()
    results = []
    for case in cases:
        context = DecisionContext.from_turn(
            case["question"],
            [HistoryTurn(**turn) for turn in case["history"]],
            case["persona_identity"],
            settings,
        )
        try:
            bundle = api.submit(context, questions).result(timeout=api.timeout)
        except TimeoutError:
            bundle = DecisionBundle(
                tuple(ChoiceResult(q.name, "timeout") for q in questions),
                api.timeout * 1000,
            )
        row = {
            "case_id": case["id"],
            "duration_ms": round(bundle.duration_ms, 2),
            "answers": [],
        }
        for question in questions:
            result = bundle.answer(question.name)
            if question.name == settings.conversation_decisions_question_name:
                expected = case["expected_reply"]
                category = reply_verdict(result, expected, settings, reply_threshold)
            else:
                expected = case["expected_scope"]
                category = "scope_" + verdict(
                    result, expected, settings, scope_threshold
                )
            counts[category] += 1
            outcomes[result.outcome] += 1
            row["answers"].append(
                {
                    "name": question.name,
                    "expected": expected,
                    "choice": result.choice,
                    "confidence": result.confidence,
                    "probabilities": dict(result.probabilities),
                    "outcome": result.outcome,
                    "verdict": category,
                }
            )
        results.append(row)
    prompt = json.dumps([q.wire() for q in questions], sort_keys=True)
    return {
        "model": settings.decisions_model,
        "sample_count": len(cases),
        "request_count": len(cases),
        "question_count": len(questions),
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "scope_threshold": scope_threshold,
        "conversation_threshold": reply_threshold,
        "counts": dict(counts),
        "outcomes": dict(outcomes),
        "cases": results,
    }
