"""Read-only Decisions access and scope calibration. No Engram or turn writes."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

from worker.config import WorkerSettings, load_settings
from worker.decisions.client import DecisionsClient, scope_question
from worker.decisions.context import DecisionContext
from worker.decisions.types import ChoiceResult
from worker.reframe.types import HistoryTurn


def load_cases(path: Path, settings: WorkerSettings) -> list[dict]:
    cases = json.loads(path.read_text(encoding="utf-8"))
    allowed = {value for value, _ in scope_question(settings).choices}
    if not isinstance(cases, list) or not cases:
        raise ValueError("fixture must be a nonempty list")
    ids = set()
    for case in cases:
        if (
            not isinstance(case, dict)
            or not isinstance(case.get("id"), str)
            or case["id"] in ids
            or not isinstance(case.get("question"), str)
            or case.get("expected") not in allowed
            or not isinstance(case.get("persona_identity"), dict)
            or not isinstance(case.get("history"), list)
        ):
            raise ValueError("invalid case")
        ids.add(case["id"])
        if any(
            not isinstance(turn, dict)
            or not isinstance(turn.get("speaker"), str)
            or not isinstance(turn.get("text"), str)
            for turn in case["history"]
        ):
            raise ValueError("invalid history")
    return cases


def verdict(
    result: ChoiceResult,
    expected: str,
    settings: WorkerSettings,
    threshold: float | None,
) -> str:
    chosen = result.choice
    if (
        result.outcome != "success"
        or result.confidence is None
        or (threshold is not None and result.confidence < threshold)
    ):
        chosen = settings.engram_retrieve_scope_both
    if chosen == expected:
        return "match"
    if chosen == settings.engram_retrieve_scope_both:
        return "conservative_both"
    return "incorrect_narrowing"


def run_probe(
    settings: WorkerSettings,
    cases: list[dict],
    api: DecisionsClient,
    threshold: float | None,
) -> dict:
    counts: Counter[str] = Counter()
    outcomes: Counter[str] = Counter()
    results = []
    for case in cases:
        identity = case["persona_identity"]
        context = DecisionContext.from_turn(
            case["question"],
            [HistoryTurn(**turn) for turn in case["history"]],
            identity,
            settings,
        )
        # Provider timeout is also used by the adapter; this never retries.
        try:
            bundle = api.submit(context).result(timeout=api.timeout)
            result = bundle.answer(settings.decisions_scope_question_name)
            duration = bundle.duration_ms
        except TimeoutError:
            result = ChoiceResult(settings.decisions_scope_question_name, "timeout")
            duration = api.timeout * 1000
        category = verdict(result, case["expected"], settings, threshold)
        counts[category] += 1
        outcomes[result.outcome] += 1
        results.append(
            {
                "case_id": case["id"],
                "expected": case["expected"],
                "choice": result.choice,
                "confidence": result.confidence,
                "probabilities": dict(result.probabilities),
                "outcome": result.outcome,
                "duration_ms": round(duration, 2),
                "verdict": category,
            }
        )
    prompt = json.dumps(scope_question(settings).wire(), sort_keys=True)
    return {
        "model": settings.decisions_model,
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "threshold": threshold,
        "sample_count": len(cases),
        "counts": dict(counts),
        "outcomes": dict(outcomes),
        "cases": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=None)
    parser.add_argument(
        "--threshold",
        type=float,
        help="Evaluate a candidate threshold; does not enable routing",
    )
    parser.add_argument(
        "--question-set", choices=("scope", "conversation", "both"), default="scope"
    )
    parser.add_argument(
        "--conversation-threshold",
        type=float,
        help="Candidate acknowledge threshold; does not enable generation",
    )
    args = parser.parse_args(argv)
    if args.fixture is None:
        args.fixture = Path(__file__).with_name(
            "probe_fixture.json"
            if args.question_set == "scope"
            else "conversation_fixture.json"
        )
    if args.conversation_threshold is not None and (
        not math.isfinite(args.conversation_threshold)
        or not 0 <= args.conversation_threshold <= 1
    ):
        parser.error("conversation threshold must be finite and between zero and one")
    if args.threshold is not None and (
        not math.isfinite(args.threshold) or not 0 <= args.threshold <= 1
    ):
        parser.error("threshold must be finite and between zero and one")
    try:
        settings = load_settings()
    except ValueError:
        print("FAIL: invalid worker configuration (values omitted)")
        return 1
    if not (settings.decisions_api_key or settings.openai_api_key):
        print("SKIP: Decisions credentials are missing; account access is unverified")
        return 0
    try:
        if args.question_set == "scope":
            cases = load_cases(args.fixture, settings)
        else:
            from worker.decisions.conversation_probe import load_reply_cases

            cases = load_reply_cases(args.fixture, settings)
    except (OSError, ValueError, TypeError):
        print("FAIL: invalid or unavailable fixture")
        return 1
    api = DecisionsClient(settings)
    try:
        if args.question_set == "scope":
            report = run_probe(settings, cases, api, args.threshold)
        else:
            from worker.decisions.conversation_probe import run_reply_probe

            report = run_reply_probe(
                settings,
                cases,
                api,
                include_scope=args.question_set == "both",
                scope_threshold=args.threshold,
                reply_threshold=args.conversation_threshold,
            )
    finally:
        api.close()
    print(json.dumps(report, indent=2))
    success = report["outcomes"].get("success", 0)
    expected_answers = len(cases) * report.get("question_count", 1)
    if success != expected_answers:
        print(
            f"FAIL: valid named choices on {success}/{expected_answers} answers; "
            "calibration incomplete (successful cases prove API access)"
        )
        return 1
    print("ACCESS_OK: classification evidence only; threshold needs owner approval")
    failures = sum(
        report["counts"].get(key, 0)
        for key in (
            "incorrect_narrowing",
            "scope_incorrect_narrowing",
            "unanswered_request",
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
