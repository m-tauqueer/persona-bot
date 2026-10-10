from concurrent.futures import Future, ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest

from worker.decisions.client import DecisionsClient
from worker.decisions.routing import scope_decision
from worker.decisions.types import ChoiceResult, DecisionBundle
from worker.engram.interface import RetrieveOutcome
from worker.engram.scope_router import ScopeDecision
from worker.reframe.types import HistoryTurn
from worker.turn.service import TurnRunner
from test_decisions import Stub, response
from test_turn import MEMBER, OTHER, PERSONA, _ScopeBrain, _mixed_hits


def configured(settings, mode="active", **extra):
    return settings.model_copy(
        update={
            "engram_scope_router_enabled": True,
            "engram_scope_router_backend": "decisions",
            "decisions_scope_mode": mode,
            "decisions_scope_min_confidence": 0.9,
            "engram_member_session_auth": True,
            **extra,
        }
    )


def retrieve(runner, brain, **extra):
    kwargs = dict(
        member_authenticated=True,
        app_user_id=uuid4(),
        engram_user_id=MEMBER,
        email="caller@example.com",
        engram_persona_id=PERSONA,
        query="What did I tell you?",
        prior_sid="sitting",
    )
    kwargs.update(extra)
    return runner._retrieve_grounded(brain, **kwargs)


def memory_brain():
    brain = _ScopeBrain()
    shared, own, other = _mixed_hits()
    brain.retrieve_scoped = lambda *args, **kwargs: RetrieveOutcome(
        results=[shared, own, other],
        raw={},
    )
    return brain


@pytest.mark.parametrize(
    "choice,expected",
    [
        ("shared", (1, 0)),
        ("private", (0, 1)),
        ("both", (1, 1)),
    ],
)
def test_active_only_discards_authorized_rows(settings, choice, expected):
    loaded = configured(settings)
    runner = TurnRunner(loaded)
    runner._decisions = DecisionsClient(
        loaded, Stub(lambda **kw: response(choice=choice))
    )
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    try:
        grounded, decision, authenticated = retrieve(runner, memory_brain())
        assert authenticated
        assert decision.scope == choice
        assert (
            len(grounded.persona_memories),
            len(grounded.caller_memories),
        ) == expected
        assert all("other" not in text for text in grounded.memories)
        assert grounded.outcome.session_id == "sitting"
        assert len(grounded.outcome.memories_used) == sum(expected)
    finally:
        runner.close()


@pytest.mark.parametrize(
    "outcome",
    ["timeout", "refusal", "malformed", "unavailable", "saturated", "input_too_large"],
)
def test_provider_fallbacks_keep_both(settings, outcome):
    decision = scope_decision(
        ChoiceResult("memory_scope", outcome), configured(settings)
    )
    assert decision.scope == "both"
    assert decision.reason


def test_low_confidence_keeps_both(settings):
    loaded = configured(settings)
    assert (
        scope_decision(
            ChoiceResult("memory_scope", "success", "private", 0.89), loaded
        ).scope
        == "both"
    )
    assert (
        scope_decision(
            ChoiceResult("memory_scope", "success", "private", 0.9), loaded
        ).scope
        == "private"
    )


class Pending:
    def __init__(self):
        self.future = Future()
        self.contexts = []

    def submit(self, context):
        self.contexts.append(context)
        return self.future

    def close(self):
        pass


def test_shadow_does_not_wait_or_mutate_reply_and_captures_ids(settings, monkeypatch):
    loaded = configured(settings, "shadow")
    runner = TurnRunner(loaded)
    pending = Pending()
    runner._decisions = pending
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    logged = []
    monkeypatch.setattr(
        runner, "_log_decisions_scope", lambda *args: logged.append(args)
    )
    sid, cid = uuid4(), uuid4()
    try:
        grounded, decision, _ = retrieve(
            runner, memory_brain(), session_id=sid, correlation_id=cid
        )
        assert not pending.future.done()
        assert len(grounded.memories) == 2
        assert decision == ScopeDecision("both", loaded.decisions_reason_shadow)
        pending.future.set_result(
            DecisionBundle(
                (ChoiceResult("memory_scope", "success", "private", 0.99),), 25
            )
        )
        assert len(grounded.memories) == 2
        assert logged[0][-2:] == (sid, cid)
    finally:
        runner.close()


@pytest.mark.parametrize("mode,enabled", [("off", True), ("active", False)])
def test_disabled_sends_no_question(settings, mode, enabled):
    loaded = configured(settings, mode, engram_scope_router_enabled=enabled)
    runner = TurnRunner(loaded)
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    try:
        grounded, decision, _ = retrieve(runner, memory_brain())
        assert runner._decisions is None
        assert len(grounded.memories) == 2
        assert decision.reason == loaded.engram_scope_router_reason_disabled
    finally:
        runner.close()


def test_uncredentialed_skips_classifier_and_private_pool(settings):
    loaded = configured(settings)
    runner = TurnRunner(loaded)
    brain = memory_brain()
    try:
        grounded, decision, _ = runner._retrieve_grounded(
            brain,
            member_authenticated=False,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="",
            engram_persona_id=PERSONA,
            query="hello",
            prior_sid=None,
        )
        assert runner._decisions is None
        assert grounded.caller_memories == []
        assert decision.reason == loaded.engram_scope_router_reason_unauthenticated
    finally:
        runner.close()


def test_request_runs_beside_both_reads(settings):
    loaded = configured(settings)
    runner = TurnRunner(loaded)
    barrier = Barrier(3, timeout=2)

    def classify(**kwargs):
        barrier.wait()
        return response()

    def read(*args, **kwargs):
        barrier.wait()
        return RetrieveOutcome(results=[], raw={})

    runner._decisions = DecisionsClient(loaded, Stub(classify))
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    brain = _ScopeBrain()
    brain.retrieve_scoped = read
    try:
        grounded, decision, _ = retrieve(runner, brain)
        assert decision.scope == "private"
        assert grounded.memories == []
    finally:
        runner.close()


def test_active_expired_budget_does_not_wait_or_apply_late_result(settings):
    import time

    loaded = configured(settings)
    runner = TurnRunner(loaded)
    future = Future()
    try:
        decision = runner._finish_decisions_scope(
            future,
            started=time.monotonic() - 10,
            member_authenticated=True,
            session_id=None,
            correlation_id=None,
        )
        assert decision.reason == loaded.engram_scope_router_reason_timeout
        future.set_result(
            DecisionBundle(
                (ChoiceResult("memory_scope", "success", "private", 0.99),), 1
            )
        )
        assert decision.scope == "both"
    finally:
        runner.close()


def test_simultaneous_sittings_keep_context_separate(settings):
    import json

    loaded = configured(settings)
    runner = TurnRunner(loaded)
    barrier = Barrier(2, timeout=2)
    seen = []

    def classify(**kwargs):
        seen.append(json.loads(kwargs["input"]))
        barrier.wait()
        return response(choice="both")

    runner._decisions = DecisionsClient(loaded, Stub(classify))
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)

    def sitting(label):
        return retrieve(
            runner,
            memory_brain(),
            history=[HistoryTurn("user", label)],
            persona_identity={loaded.persona_identity_name_key: label},
            engram_user_id=MEMBER if label == "persona-a" else OTHER,
            engram_persona_id=PERSONA if label == "persona-a" else uuid4().hex,
        )

    try:
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(sitting, ["persona-a", "persona-b"]))
        assert all(result[1].scope == "both" for result in results)
        assert results[0][0].caller_memories != results[1][0].caller_memories
        assert all(len(result[0].caller_memories) == 1 for result in results)
        assert len(seen) == 2
        for context in seen:
            assert (
                context["history"][0]["text"]
                == context["persona_identity"][loaded.persona_identity_name_key]
            )
    finally:
        runner.close()
