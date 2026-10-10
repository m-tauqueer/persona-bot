import json
from concurrent.futures import Future
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from worker.config import WorkerSettings
from worker.controller.decision import Action, Decision, ReasonCode
from worker.decisions.client import DecisionsClient
from worker.decisions.conversation import conversation_decision, conversation_question
from worker.decisions.types import ChoiceResult, DecisionBundle
from worker.reframe.answerer import Answerer
from worker.reframe.errors import ReframeError
from worker.turn.service import TurnRunner
from test_decisions import Stub, response
from test_decisions_turn import configured, memory_brain, retrieve
from test_turn import MEMBER, PERSONA, _retrieve_plan


def reply_response(choice="acknowledge", confidence=0.99):
    return {
        "name": "reply_mode",
        "type": "choice",
        "choice": choice,
        "confidence": confidence,
        "probabilities": [
            {"value": "answer", "probability": 0.01},
            {"value": "acknowledge", "probability": 0.99},
        ],
    }


def settings_for(settings, **extra):
    return configured(
        settings,
        conversation_decisions_mode="active",
        conversation_decisions_min_confidence=0.9,
        **extra,
    )


@pytest.mark.parametrize(
    "extra",
    [
        {"conversation_decisions_mode": "bad"},
        {"conversation_decisions_min_confidence": float("nan")},
        {"conversation_decisions_min_confidence": 1.1},
        {"conversation_decisions_question_name": "memory_scope"},
        {"conversation_decisions_answer_value": "acknowledge"},
        {"conversation_decisions_hint_key": "question"},
        {"conversation_decisions_generation_instructions": "{unknown}"},
        {"conversation_decisions_reason_shadow": "reply_disabled"},
        {"conversation_decisions_reason_shadow": "timeout"},
    ],
)
def test_configuration_rejects_unsafe_conversation_settings(settings, extra):
    with pytest.raises(ValidationError):
        WorkerSettings(_env_file=None, **(settings.model_dump() | extra))


def test_active_requires_credential_and_threshold_independently_of_scope(settings):
    data = settings.model_dump() | {"conversation_decisions_mode": "active"}
    with pytest.raises(ValidationError, match="requires DECISIONS_API_KEY"):
        WorkerSettings(_env_file=None, **data)
    data["decisions_api_key"] = "synthetic-key"
    with pytest.raises(ValidationError, match="calibrated threshold"):
        WorkerSettings(_env_file=None, **data)
    data["conversation_decisions_min_confidence"] = 0.9
    assert (
        WorkerSettings(_env_file=None, **data).conversation_decisions_mode == "active"
    )


@pytest.mark.parametrize(
    "outcome",
    ["timeout", "refusal", "malformed", "unavailable", "saturated", "input_too_large"],
)
def test_provider_faults_fall_back_to_answer(settings, outcome):
    chosen = conversation_decision(
        ChoiceResult("reply_mode", outcome), settings_for(settings)
    )
    assert chosen.mode == "answer"
    assert chosen.reason.startswith("reply_")


def test_acknowledge_requires_confidence_and_eligibility(settings):
    loaded = settings_for(settings)
    result = ChoiceResult("reply_mode", "success", "acknowledge", 0.89)
    assert conversation_decision(result, loaded).mode == "answer"
    result = ChoiceResult("reply_mode", "success", "acknowledge", 0.9)
    assert conversation_decision(result, loaded).mode == "acknowledge"
    assert (
        conversation_decision(result, loaded, speak_eligible=False).reason
        == "reply_ineligible"
    )
    assert (
        conversation_decision(
            result, loaded.model_copy(update={"brain_mode": "chat"})
        ).reason
        == "reply_chat"
    )


@pytest.mark.parametrize("scope_mode", ["off", "shadow", "active"])
@pytest.mark.parametrize("reply_mode", ["off", "shadow", "active"])
def test_mode_matrix_one_request_and_independent_policies(
    settings, scope_mode, reply_mode
):
    loaded = configured(settings, scope_mode).model_copy(
        update={
            "conversation_decisions_mode": reply_mode,
            "conversation_decisions_min_confidence": 0.9,
        }
    )

    def provider(**kwargs):
        answers = []
        for question in kwargs["questions"]:
            answers.append(
                reply_response()
                if question["name"] == "reply_mode"
                else response()["answers"][0]
            )
        return {"answers": list(reversed(answers))}

    stub = Stub(provider)
    runner = TurnRunner(loaded)
    runner._decisions = DecisionsClient(loaded, stub)
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    try:
        grounded, scope, _ = retrieve(runner, memory_brain())
        runner._decisions.close()  # Drain shadow metadata, never the reply path.
        assert len(stub.calls) == int(scope_mode != "off" or reply_mode != "off")
        if stub.calls:
            expected = ({"memory_scope"} if scope_mode != "off" else set()) | (
                {"reply_mode"} if reply_mode != "off" else set()
            )
            assert {q["name"] for q in stub.calls[0]["questions"]} == expected
        assert scope.scope == ("private" if scope_mode == "active" else "both")
        if reply_mode == "off":
            assert grounded.conversation is None
        else:
            assert grounded.conversation.mode == (
                "acknowledge" if reply_mode == "active" else "answer"
            )
            if reply_mode == "shadow":
                assert grounded.conversation.reason == "reply_shadow"
    finally:
        runner.close()


@pytest.mark.parametrize("broken_name", ["memory_scope", "reply_mode"])
def test_one_invalid_answer_does_not_erase_the_other(settings, broken_name):
    loaded = settings_for(settings)
    payload = response()
    payload["answers"].append(reply_response())
    next(a for a in payload["answers"] if a["name"] == broken_name)["type"] = "refusal"
    runner = TurnRunner(loaded)
    runner._decisions = DecisionsClient(loaded, Stub(lambda **kw: payload))
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    try:
        grounded, scope, _ = retrieve(runner, memory_brain())
        assert scope.scope == ("both" if broken_name == "memory_scope" else "private")
        assert grounded.conversation.mode == (
            "answer" if broken_name == "reply_mode" else "acknowledge"
        )
    finally:
        runner.close()


def test_shared_only_member_gets_reply_question_without_scope_or_private_rows(settings):
    loaded = settings_for(settings)
    stub = Stub(lambda **kw: {"answers": [reply_response()]})
    runner = TurnRunner(loaded)
    runner._decisions = DecisionsClient(loaded, stub)
    try:
        grounded, scope, _ = retrieve(
            runner, memory_brain(), member_authenticated=False
        )
        assert [q["name"] for q in stub.calls[0]["questions"]] == ["reply_mode"]
        assert grounded.caller_memories == []
        assert grounded.conversation.mode == "acknowledge"
        assert scope.scope == "both"
    finally:
        runner.close()


def test_chat_mode_skips_conversation_request(settings):
    loaded = settings_for(
        settings, brain_mode="chat", engram_scope_router_enabled=False
    )
    runner = TurnRunner(loaded)
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    try:
        assert not runner._conversation_enabled()
        retrieve(runner, memory_brain())
        assert runner._decisions is None
        assert conversation_decision(None, loaded).reason == "reply_chat"
        degraded = _retrieve_plan()
        degraded.conversation = conversation_decision(None, loaded)
        assert runner._reply_mode_kwargs(degraded) == {}
    finally:
        runner.close()


def test_all_shadow_does_not_wait_and_late_result_cannot_mutate(settings):
    loaded = settings_for(settings).model_copy(
        update={
            "decisions_scope_mode": "shadow",
            "conversation_decisions_mode": "shadow",
        }
    )
    runner = TurnRunner(loaded)
    future = Future()
    try:
        scope, reply = runner._finish_decisions_bundle(
            future,
            started=0,
            member_authenticated=True,
            session_id=uuid4(),
            correlation_id=uuid4(),
        )
        assert not future.done()
        assert (scope.scope, reply.mode) == ("both", "answer")
        future.set_result(
            DecisionBundle(
                (ChoiceResult("reply_mode", "success", "acknowledge", 0.99),), 10
            )
        )
        assert reply.mode == "answer"
    finally:
        runner.close()


def answer_kwargs():
    return dict(
        persona_memories=["Ada knows astronomy"],
        caller_memories=[],
        persona_identity={"name": "Ada"},
        history=[],
        question="Thanks",
        voice_config={},
    )


def test_generation_hint_survives_custom_prompt_and_configured_values(settings):
    loaded = settings.model_copy(
        update={
            "answer_system_prompt": "CUSTOM SYSTEM",
            "conversation_decisions_hint_key": "response_style",
            "conversation_decisions_answer_value": "full",
            "conversation_decisions_acknowledge_value": "brief",
        }
    )
    answerer = Answerer(loaded, SimpleNamespace())
    _, messages = answerer._request(**answer_kwargs(), reply_mode="brief")
    assert messages[0]["content"].startswith("CUSTOM SYSTEM")
    assert "durable storage" in messages[0]["content"]
    assert "response_style" in messages[0]["content"]
    assert json.loads(messages[1]["content"])["response_style"] == "brief"
    _, baseline = answerer._request(**answer_kwargs())
    assert baseline[0]["content"] == "CUSTOM SYSTEM"
    assert "response_style" not in json.loads(baseline[1]["content"])
    with pytest.raises(ReframeError):
        answerer._request(**answer_kwargs(), reply_mode="wait")


@pytest.mark.parametrize("streaming", [False, True])
def test_blocking_and_streaming_generation_use_one_call_with_hint(settings, streaming):
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        if kwargs.get("stream"):
            return iter(
                [
                    SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                delta=SimpleNamespace(content="Understood.")
                            )
                        ]
                    )
                ]
            )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Understood."))]
        )

    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    answerer = Answerer(settings, client)
    spoken = (
        "".join(answerer.stream(**answer_kwargs(), reply_mode="acknowledge"))
        if streaming
        else answerer.answer(**answer_kwargs(), reply_mode="acknowledge")
    )
    assert spoken == "Understood."
    assert len(calls) == 1
    assert json.loads(calls[0]["messages"][1]["content"])["reply_mode"] == "acknowledge"


def test_turn_speaking_guard_preserves_silence_and_writeback(settings):
    loaded = settings_for(settings, engram_converse_writeback=True)
    runner = TurnRunner(loaded)
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.conversation = conversation_decision(
        ChoiceResult("reply_mode", "success", "acknowledge", 0.99), loaded
    )
    try:
        assert runner._reply_mode_kwargs(plan) == {"reply_mode": "acknowledge"}
        assert runner._should_write_back(plan)
        plan.speaks = False
        plan.decision = Decision(Action.SILENCE, (ReasonCode.EMPTY_INPUT,), {})
        assert runner._reply_mode_kwargs(plan) == {}
        with pytest.raises(Exception, match="turn does not speak"):
            runner.speak(plan)
    finally:
        runner.close()


def test_combined_probe_counts_unanswered_requests_and_one_request(settings):
    from worker.decisions.conversation_probe import load_reply_cases, run_reply_probe

    fixture = Path(__file__).parent / "fixtures" / "decisions" / "conversation.json"
    cases = load_reply_cases(fixture, settings)
    from worker.decisions import conversation_probe

    assert cases == json.loads(
        Path(conversation_probe.__file__)
        .with_name("conversation_fixture.json")
        .read_text()
    )
    stub = Stub(lambda **kw: {"answers": [response()["answers"][0], reply_response()]})
    api = DecisionsClient(settings, stub)
    try:
        report = run_reply_probe(
            settings,
            cases,
            api,
            include_scope=True,
            scope_threshold=0.9,
            reply_threshold=0.9,
        )
        assert len(stub.calls) == len(cases)
        assert all(len(call["questions"]) == 2 for call in stub.calls)
        assert report["question_count"] == 2
        assert report["counts"]["unanswered_request"] == sum(
            c["expected_reply"] == "answer" for c in cases
        )
        assert all("question" not in row for row in report["cases"])
        assert all(
            case["question"] not in json.dumps(report["cases"]) for case in cases
        )
    finally:
        api.close()


def test_acknowledged_turn_persists_mode_and_actual_utterance(settings, monkeypatch):
    import worker.turn.service as service

    loaded = settings_for(settings)
    runner = TurnRunner(loaded)
    rows = []
    monkeypatch.setattr(service, "claim_write_receipt", lambda *a: True)
    monkeypatch.setattr(service, "next_ordinal", lambda *a: 1)
    monkeypatch.setattr(service, "store_receipt_turn_ids", lambda *a, **kw: None)
    monkeypatch.setattr(
        service, "insert_turn", lambda conn, **kw: rows.append(kw) or uuid4()
    )
    monkeypatch.setattr(service, "insert_latency_spans", lambda *a, **kw: None)
    plan = _retrieve_plan()
    from worker.engram.interface import ChatOutcome

    reply = conversation_decision(
        ChoiceResult("reply_mode", "success", "acknowledge", 0.99), loaded
    )
    try:
        runner._persist(
            None,
            session_id=plan.session_id,
            user_text="I play cello.",
            decision=plan.decision,
            spoken="That sounds enjoyable.",
            outcome=ChatOutcome(
                messages=["caller fact"],
                text="caller fact",
                memories_used=[],
                session_id=None,
                raw={},
                brain_ms=1,
            ),
            engram_session_id=None,
            brain_ms=1,
            reframe_ms=2,
            reframe_first_token_ms=1,
            total_ms=3,
            mode="retrieve",
            correlation_id=plan.correlation_id,
            conversation=reply,
        )
        assert len(rows) == 2
        assert rows[1]["text"] == "That sounds enjoyable."
        assert rows[0]["controller_action"] == "speak"
        assert "acknowledge" in rows[0]["controller_reasons"]
        assert "reply_acknowledge" in rows[1]["controller_reasons"]
        assert ReasonCode.HAS_GROUNDED_REPLY.value in rows[0]["controller_reasons"]
    finally:
        runner.close()


def test_acknowledged_fact_still_reaches_private_extractor(settings, monkeypatch):
    from test_turn import _stub_writeback_db, _Extract
    from worker.engram.caller_facts import CallerFactExtract

    _stub_writeback_db(monkeypatch)
    loaded = settings_for(settings, engram_converse_writeback=True)
    runner = TurnRunner(loaded)
    runner._extractor = _Extract(
        CallerFactExtract(
            ["The caller plays cello."], loaded.caller_fact_reason_extracted
        )
    )
    ingested = []

    class Active:
        def ingest_private_text(self, persona_id, text):
            ingested.append((persona_id, text))
            return {"ok": True}

    runner._run_member_op = lambda brain, op, **kw: op(Active())
    runner._member_brains.get = lambda uid: Active()
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.app_user_id = uuid4()
    plan.text = "I play cello."
    plan.spoken = "That sounds enjoyable."
    plan.conversation = conversation_decision(
        ChoiceResult("reply_mode", "success", "acknowledge", 0.99), loaded
    )
    try:
        runner._write_back(plan)
        assert len(ingested) == 1
        assert ingested[0][0] == PERSONA
        assert "cello" in ingested[0][1]
    finally:
        runner.close()


@pytest.mark.parametrize("streaming", [False, True])
def test_turn_runner_forwards_reply_mode_to_generation(settings, streaming):
    from worker.engram.interface import ChatOutcome

    runner = TurnRunner(settings_for(settings))
    plan = _retrieve_plan()
    plan.outcome = ChatOutcome(
        messages=["memory"],
        text="memory",
        memories_used=[],
        session_id=None,
        raw={},
        brain_ms=1,
    )
    plan.conversation = conversation_decision(
        ChoiceResult("reply_mode", "success", "acknowledge", 0.99), runner._settings
    )
    calls = []

    def answer(**kwargs):
        calls.append(kwargs)
        return "Understood."

    runner._answerer = SimpleNamespace(
        answer=answer, stream=lambda **kwargs: iter([answer(**kwargs)])
    )
    try:
        spoken = "".join(runner.stream_speak(plan)) if streaming else runner.speak(plan)
        assert spoken == "Understood."
        assert plan.spoken == spoken
        assert len(calls) == 1
        assert calls[0]["reply_mode"] == "acknowledge"
    finally:
        runner.close()


def test_legacy_scope_rollback_can_coexist_with_conversation(settings):
    from worker.engram.scope_router import ScopeDecision

    loaded = settings_for(settings, engram_scope_router_backend="chat_completions")
    runner = TurnRunner(loaded)
    runner._scope_router = SimpleNamespace(
        decide=lambda question: ScopeDecision("shared", "persona")
    )
    stub = Stub(lambda **kw: {"answers": [reply_response()]})
    runner._decisions = DecisionsClient(loaded, stub)
    runner._run_member_op = lambda brain, op, **kwargs: op(brain)
    try:
        grounded, scope, _ = retrieve(runner, memory_brain())
        assert scope.scope == "shared"
        assert grounded.conversation.mode == "acknowledge"
        assert len(stub.calls) == 1
        assert [q["name"] for q in stub.calls[0]["questions"]] == ["reply_mode"]
    finally:
        runner.close()


def test_expired_combined_deadline_keeps_both_and_answers(settings):
    import time

    runner = TurnRunner(settings_for(settings))
    future = Future()
    try:
        scope, reply = runner._finish_decisions_bundle(
            future,
            started=time.monotonic() - 10,
            member_authenticated=True,
            session_id=uuid4(),
            correlation_id=uuid4(),
        )
        assert scope.scope == "both"
        assert reply.mode == "answer"
        assert reply.reason == "reply_timeout"
        future.set_result(
            DecisionBundle(
                (ChoiceResult("reply_mode", "success", "acknowledge", 0.99),), 10
            )
        )
        assert reply.mode == "answer"
    finally:
        runner.close()


def test_simultaneous_combined_requests_keep_reply_choices_with_their_sitting(settings):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from worker.reframe.types import HistoryTurn
    from test_turn import OTHER

    loaded = settings_for(settings)
    barrier = Barrier(2, timeout=2)

    def classify(**kwargs):
        context = json.loads(kwargs["input"])
        label = context["history"][0]["text"]
        barrier.wait()
        return {
            "answers": [
                response(choice="both")["answers"][0],
                reply_response("acknowledge" if label == "caller-a" else "answer"),
            ]
        }

    runner = TurnRunner(loaded)
    runner._decisions = DecisionsClient(loaded, Stub(classify))
    runner._run_member_op = lambda brain, op, **kw: op(brain)

    def sitting(label):
        return retrieve(
            runner,
            memory_brain(),
            engram_user_id=MEMBER if label == "caller-a" else OTHER,
            engram_persona_id=PERSONA if label == "caller-a" else uuid4().hex,
            history=[HistoryTurn("user", label)],
            session_id=uuid4(),
            correlation_id=uuid4(),
        )

    try:
        with ThreadPoolExecutor(2) as pool:
            first, second = list(pool.map(sitting, ["caller-a", "caller-b"]))
        assert first[0].conversation.mode == "acknowledge"
        assert second[0].conversation.mode == "answer"
        assert first[0].caller_memories != second[0].caller_memories
    finally:
        runner.close()
