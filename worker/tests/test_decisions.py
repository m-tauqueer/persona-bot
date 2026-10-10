import copy
from threading import Event
from types import SimpleNamespace

import httpx
import pytest
from openai import APITimeoutError

from worker.config import WorkerSettings
from worker.decisions.client import DecisionsClient, decode_choice, scope_question
from worker.decisions.context import DecisionContext


def response(name="memory_scope", choice="private", confidence=0.99):
    return {
        "answers": [
            {
                "name": name,
                "type": "choice",
                "choice": choice,
                "confidence": confidence,
                "probabilities": [
                    {"value": "shared", "probability": 0.01},
                    {"value": "private", "probability": 0.98},
                    {"value": "both", "probability": 0.01},
                ],
            }
        ]
    }


class Stub:
    def __init__(self, create=None):
        self.calls = []
        self.decisions = SimpleNamespace(create=self.create)
        self._create = create or (lambda **kwargs: response())

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._create(**kwargs)


def test_named_answers_and_confidence_are_distinct(settings: WorkerSettings) -> None:
    payload = response()
    payload["answers"].insert(0, {"name": "other", "type": "refusal"})
    parsed = decode_choice(payload, scope_question(settings))
    assert parsed.choice == "private"
    assert parsed.confidence == 0.99
    assert dict(parsed.probabilities)["private"] == 0.98
    payload["answers"].append(copy.deepcopy(payload["answers"][1]))
    assert decode_choice(payload, scope_question(settings)).outcome == "malformed"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda a: a.update(choice="someone-elses-pool"),
        lambda a: a.update(confidence=float("nan")),
        lambda a: a.update(confidence=float("inf")),
        lambda a: a.update(confidence=True),
        lambda a: a.update(confidence="0.99"),
        lambda a: a.update(type="score"),
        lambda a: a.update(probabilities=[]),
        lambda a: a["probabilities"][0].update(probability=-1),
        lambda a: a["probabilities"].append(a["probabilities"][0]),
        lambda a: a.update(probabilities=[None]),
    ],
)
def test_invalid_choice_answers_are_rejected(settings, mutate):
    payload = response()
    mutate(payload["answers"][0])
    assert decode_choice(payload, scope_question(settings)).outcome == "malformed"


@pytest.mark.parametrize("payload", [{}, None, {"answers": []}, {"answers": "wrong"}])
def test_missing_answers_are_malformed(settings, payload):
    assert decode_choice(payload, scope_question(settings)).outcome == "malformed"


def test_refusal_is_per_question(settings):
    payload = {"answers": [{"name": "memory_scope", "type": "refusal"}]}
    assert decode_choice(payload, scope_question(settings)).outcome == "refusal"


def test_request_only_sends_supported_provider_fields(settings):
    stub = Stub()
    api = DecisionsClient(settings, stub)
    try:
        result = api.submit(DecisionContext("caller question")).result(timeout=2)
        assert result.answer("memory_scope").choice == "private"
        assert result.answer("missing").outcome == "malformed"
        assert len(stub.calls) == 1
        assert set(stub.calls[0]) == {"model", "input", "questions", "timeout"}
        assert stub.calls[0]["timeout"] <= api.timeout
    finally:
        api.close()


@pytest.mark.parametrize(
    "error,outcome",
    [
        (RuntimeError("never-log-input-or-key"), "unavailable"),
        (
            APITimeoutError(
                httpx.Request("POST", "https://api.openai.com/v1/decisions")
            ),
            "timeout",
        ),
    ],
)
def test_faults_do_not_retry_or_throw(settings, error, outcome):
    def fail(**kwargs):
        raise error

    stub = Stub(fail)
    api = DecisionsClient(settings, stub)
    try:
        result = api.submit(DecisionContext("q")).result(timeout=2)
        assert result.answer("memory_scope").outcome == outcome
        assert len(stub.calls) == 1
    finally:
        api.close()


def test_capacity_includes_running_and_queued_work_until_completion(settings):
    entered, release, completed = Event(), Event(), Event()
    clock = [0.0]

    def block(**kwargs):
        entered.set()
        assert release.wait(2)
        return response()

    loaded = settings.model_copy(
        update={
            "engram_scope_router_workers": 1,
            "decisions_max_in_flight": 2,
        }
    )
    stub = Stub(block)
    api = DecisionsClient(loaded, stub, clock=lambda: clock[0])
    try:
        first = api.submit(DecisionContext("first"))
        assert entered.wait(1)
        queued = api.submit(DecisionContext("second"))
        queued.add_done_callback(lambda f: completed.set())
        assert not first.cancel()
        clock[0] = 10.0
        assert (
            api.submit(DecisionContext("third")).result().answer("memory_scope").outcome
            == "saturated"
        )
        release.set()
        assert first.result(timeout=2).answer("memory_scope").outcome == "timeout"
        assert queued.result(timeout=2).answer("memory_scope").outcome == "timeout"
        assert completed.wait(1)
        assert len(stub.calls) == 1
    finally:
        release.set()
        api.close()


def test_oversized_and_closed_requests_never_call_provider(settings):
    stub = Stub()
    api = DecisionsClient(
        settings.model_copy(update={"decisions_input_max_bytes": 1}), stub
    )
    assert (
        api.submit(DecisionContext("q")).result().answer("memory_scope").outcome
        == "input_too_large"
    )
    api.close()
    api = DecisionsClient(settings, stub)
    api.close()
    assert (
        api.submit(DecisionContext("q")).result().answer("memory_scope").outcome
        == "unavailable"
    )
    assert not stub.calls


def test_independent_questions_share_one_request(settings):
    second = scope_question(settings)
    from dataclasses import replace

    second = replace(second, name="independent")
    payload = response()
    payload["answers"].append({"name": "independent", "type": "refusal"})
    api = DecisionsClient(settings, Stub(lambda **kwargs: payload))
    try:
        bundle = api.submit(
            DecisionContext("q"), (scope_question(settings), second)
        ).result()
        assert bundle.answer("memory_scope").choice == "private"
        assert bundle.answer("independent").outcome == "refusal"
        assert (
            api.submit(DecisionContext("q"), (second, second))
            .result()
            .answers[0]
            .outcome
            == "malformed"
        )
    finally:
        api.close()
