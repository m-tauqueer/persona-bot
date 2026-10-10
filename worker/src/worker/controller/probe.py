"""Feed representative chat outcomes and print speak/silence decisions."""

from __future__ import annotations

import sys

from worker.controller.controller import Controller
from worker.controller.decision import Action, ReasonCode, TurnSignals
from worker.engram.errors import BrainError, NotSubscribedError, ServerError
from worker.engram.interface import ChatOutcome


def _outcome(
    *,
    messages: list[str],
    memories_used: list[object] | None = None,
    session_id: str | None = "sess-1",
) -> ChatOutcome:
    return ChatOutcome(
        messages=messages,
        text=" ".join(messages),
        memories_used=memories_used if memories_used is not None else [],
        session_id=session_id,
        raw={},
        brain_ms=1,
    )


def main() -> int:
    controller = Controller()
    inbound = TurnSignals(has_inbound_text=True)
    Case = tuple[str, ChatOutcome | BrainError, TurnSignals, Action, ReasonCode]
    cases: list[Case] = [
        (
            "grounded_reply",
            _outcome(messages=["I walked the Thames"], memories_used=[{"gid": 1}]),
            inbound,
            Action.SPEAK,
            ReasonCode.HAS_GROUNDED_REPLY,
        ),
        (
            "messages_without_memories",
            _outcome(messages=["I kept to the river."], memories_used=[]),
            inbound,
            Action.SPEAK,
            ReasonCode.HAS_GROUNDED_REPLY,
        ),
        (
            "empty_messages",
            _outcome(messages=[], memories_used=[]),
            inbound,
            Action.SILENCE,
            ReasonCode.EMPTY_REPLY,
        ),
        (
            "blank_messages",
            _outcome(messages=["", "   "], memories_used=[]),
            inbound,
            Action.SILENCE,
            ReasonCode.EMPTY_REPLY,
        ),
        (
            "not_subscribed",
            NotSubscribedError("not subscribed", status=403),
            inbound,
            Action.SILENCE,
            ReasonCode.NOT_SUBSCRIBED,
        ),
        (
            "server_error",
            ServerError("engram down", status=503),
            inbound,
            Action.SILENCE,
            ReasonCode.SERVER_ERROR,
        ),
        (
            "empty_input",
            _outcome(messages=["should not speak"]),
            TurnSignals(has_inbound_text=False),
            Action.SILENCE,
            ReasonCode.EMPTY_INPUT,
        ),
    ]

    failed = 0
    pre = controller.pre(TurnSignals(has_inbound_text=False))
    if (
        pre is None
        or pre.action is not Action.SILENCE
        or ReasonCode.EMPTY_INPUT not in pre.reasons
    ):
        print("pre_empty_input=FAIL", file=sys.stderr)
        failed += 1
    else:
        print("pre_empty_input=ok")
    if controller.pre(inbound) is not None:
        print("pre_with_text=FAIL", file=sys.stderr)
        failed += 1
    else:
        print("pre_with_text=ok")

    for name, outcome, signals, want_action, want_reason in cases:
        decision = controller.decide(outcome, signals)
        reasons = [reason.value for reason in decision.reasons]
        ok = decision.action is want_action and want_reason in decision.reasons
        print(
            f"{name} action={decision.action.value} reasons={reasons} "
            f"hints={decision.hints} expect={want_action.value}/{want_reason.value} "
            f"{'ok' if ok else 'FAIL'}"
        )
        if not ok:
            failed += 1

    if failed:
        print(f"FAIL: {failed} case(s)", file=sys.stderr)
        return 1
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
