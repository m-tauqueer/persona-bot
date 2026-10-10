from worker.controller.controller import Controller
from worker.controller.decision import Action, ReasonCode, TurnSignals
from worker.engram.errors import BrainError, NotSubscribedError, ServerError
from worker.engram.interface import ChatOutcome


def _outcome(
    *,
    messages: list[str],
    memories_used: list[object] | None = None,
) -> ChatOutcome:
    return ChatOutcome(
        messages=messages,
        text=" ".join(messages),
        memories_used=memories_used if memories_used is not None else [],
        session_id="sess-1",
        raw={},
        brain_ms=1,
    )


def test_pre_halts_on_empty_input() -> None:
    controller = Controller()
    halted = controller.pre(TurnSignals(has_inbound_text=False))
    assert halted is not None
    assert halted.action is Action.SILENCE
    assert ReasonCode.EMPTY_INPUT in halted.reasons
    assert controller.pre(TurnSignals(has_inbound_text=True)) is None


def test_decide_speaks_on_grounded_reply() -> None:
    decision = Controller().decide(
        _outcome(messages=["I walked the Thames"], memories_used=[{"gid": 1}]),
        TurnSignals(has_inbound_text=True),
    )
    assert decision.action is Action.SPEAK
    assert ReasonCode.HAS_GROUNDED_REPLY in decision.reasons


def test_decide_silences_blank_or_empty_replies() -> None:
    inbound = TurnSignals(has_inbound_text=True)
    empty = Controller().decide(_outcome(messages=[]), inbound)
    blank = Controller().decide(_outcome(messages=["", "   "]), inbound)
    assert empty.action is Action.SILENCE
    assert ReasonCode.EMPTY_REPLY in empty.reasons
    assert blank.action is Action.SILENCE
    assert ReasonCode.EMPTY_REPLY in blank.reasons


def test_decide_maps_brain_errors() -> None:
    inbound = TurnSignals(has_inbound_text=True)
    missing = Controller().decide(NotSubscribedError("no", status=403), inbound)
    down = Controller().decide(ServerError("down", status=503), inbound)
    other = Controller().decide(BrainError("other"), inbound)
    assert missing.reasons == (ReasonCode.NOT_SUBSCRIBED,)
    assert down.reasons == (ReasonCode.SERVER_ERROR,)
    assert other.reasons == (ReasonCode.BRAIN_ERROR,)


def test_empty_input_wins_over_a_deliverable_outcome() -> None:
    decision = Controller().decide(
        _outcome(messages=["should not speak"]),
        TurnSignals(has_inbound_text=False),
    )
    assert decision.action is Action.SILENCE
    assert ReasonCode.EMPTY_INPUT in decision.reasons
