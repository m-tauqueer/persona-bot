"""Run the same conversation through both brain paths and compare.

Both paths keep Engram as the memory. "chat" asks Engram to compose the reply;
"retrieve" reads memory and composes it here, writing the turn back with
converse. This drives the real TurnRunner in each mode, so what it measures is
the shipped code path and not a sketch of it.

    uv run python -m worker.brain.probe
"""

from __future__ import annotations

import sys
import time

from worker.admin.store import connect, write_probe_persona
from worker.config import load_settings
from worker.persistence.sessions import create_session
from worker.schema import SESSION_CHANNEL_VOICE
from worker.turn.errors import TurnError
from worker.turn.service import TurnRunner

# Each turn is (label, text). Turns run in order in one session per mode, so
# continuity can be checked the way a real conversation would exercise it.
QUESTIONS: list[tuple[str, str]] = [
    ("memory-rich", "What are you working on right now?"),
    ("private recall", "What did I tell you about the probes?"),
    (
        "continuity: set up",
        "For the rest of this call, call me Skipper.",
    ),
    ("continuity: check", "What did I just ask you to call me?"),
    (
        "NO memory (must not invent)",
        "What is the capital of Mongolia, and what did I have for breakfast?",
    ),
]

MODES = ("chat", "retrieve")


def _spoken(runner: TurnRunner, **kwargs) -> tuple[str, float, object]:
    """One turn, streamed, timed to the first spoken word."""
    started = time.perf_counter()
    plan = runner.begin(**kwargs)
    first: float | None = None
    parts: list[str] = []
    if plan.speaks:
        for piece in runner.stream_speak(plan):
            if first is None:
                first = (time.perf_counter() - started) * 1000
            parts.append(piece)
    runner.finish(plan)
    return "".join(parts).strip(), first or 0.0, plan


def main() -> int:
    base = load_settings()
    if not base.probe_persona_id:
        print(f"brains=SKIP {base.probe_write_skip}")
        print("PROBE_OK")
        return 0
    conn = connect(base)
    try:
        persona = write_probe_persona(conn, base)
        if persona is None:
            print(
                "FAIL: PROBE_PERSONA_ID is missing or unpublished locally",
                file=sys.stderr,
            )
            return 1
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, engram_user_id FROM users ORDER BY created_at LIMIT 1",
            )
            user = cur.fetchone()
        if user is None:
            print("FAIL: no app user in the database", file=sys.stderr)
            return 1

        print(f"default_brain_mode={base.brain_mode}")
        print(
            f"retrieve_top_k=shared {base.engram_retrieve_top_k_shared}"
            f" / private {base.engram_retrieve_top_k_private}",
        )
        print(f"model={base.openai_model}\n")

        timings: dict[str, list[float]] = {}
        sessions: dict[str, str] = {}
        runners: dict[str, TurnRunner] = {}
        for mode in MODES:
            if mode == "chat" and not base.engram_member_session_auth:
                print(f"chat=SKIP {base.probe_chat_mode_skip}")
                continue
            settings = base.model_copy(update={"brain_mode": mode})
            runners[mode] = TurnRunner(settings)
            session = create_session(
                conn,
                user_id=user["id"],
                persona_id=persona["id"],
                channel=SESSION_CHANNEL_VOICE,
            )
            conn.commit()
            sessions[mode] = str(session["id"])
            timings[mode] = []
            print(f"{mode}_session={sessions[mode]}")
        if not runners:
            print("brains=SKIP no brain mode left to run")
            print("PROBE_OK")
            return 0
    finally:
        conn.close()
    print()

    failed = 0
    for label, question in QUESTIONS:
        print("=" * 78)
        print(f"[{label}] {question}")
        for mode in runners:
            try:
                spoken, first_ms, plan = _spoken(
                    runners[mode],
                    app_user_id=user["id"],
                    engram_user_id=user["engram_user_id"],
                    persona_id=persona["id"],
                    session_id=sessions[mode],
                    text=question,
                )
            except TurnError as exc:
                print(f"  {mode:<9} FAIL {exc}", file=sys.stderr)
                failed += 1
                continue
            timings[mode].append(first_ms)
            grounding = (
                f"{len(plan.persona_memories)} persona / "
                f"{len(plan.caller_memories)} caller"
                if mode == "retrieve"
                else str(
                    len(plan.outcome.messages if plan.outcome else []),
                )
            )
            engram_s = (plan.brain_ms or 0) / 1000
            print(
                f"\n  {mode:<9}{first_ms / 1000:6.2f}s to first word "
                f"(engram {engram_s:.2f}s, {grounding} grounding)"
            )
            print(f"    -> {spoken or '(silence)'}")
            if not spoken:
                failed += 1
            if label.startswith("NO memory"):
                print("      ^ judge this one: inventing here breaks the fact lock")
        print()

    for runner in runners.values():
        runner.close()

    print("=" * 78)
    for mode in MODES:
        values = sorted(timings[mode])
        if not values:
            continue
        median = values[len(values) // 2]
        print(f"{mode:<9} median to first word: {median / 1000:.2f}s")
    print("\nread the two answers per question, not just the clock")

    if failed:
        print(f"FAIL: {failed} turn(s)", file=sys.stderr)
        return 1
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
