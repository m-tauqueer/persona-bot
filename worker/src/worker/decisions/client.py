from __future__ import annotations

import math
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from threading import BoundedSemaphore, Lock
from typing import Any

from openai import APITimeoutError

from worker.clients import create_decisions
from worker.config import WorkerSettings
from worker.decisions.context import DecisionContext
from worker.decisions.types import (
    ChoiceOutcome,
    ChoiceQuestion,
    ChoiceResult,
    DecisionBundle,
)


def scope_question(settings: WorkerSettings) -> ChoiceQuestion:
    return ChoiceQuestion(
        settings.decisions_scope_question_name,
        settings.decisions_scope_instructions,
        (
            (
                settings.engram_retrieve_scope_shared,
                settings.decisions_scope_shared_description,
            ),
            (
                settings.engram_retrieve_scope_private,
                settings.decisions_scope_private_description,
            ),
            (
                settings.engram_retrieve_scope_both,
                settings.decisions_scope_both_description,
            ),
        ),
    )


def _probability(value: object) -> bool:
    if type(value) not in (int, float) or not 0 <= value <= 1:
        return False
    return math.isfinite(value)


def decode_choice(payload: Any, question: ChoiceQuestion) -> ChoiceResult:
    bad = ChoiceResult(question.name, "malformed")
    if not isinstance(payload, dict) or not isinstance(payload.get("answers"), list):
        return bad
    found = [
        answer
        for answer in payload["answers"]
        if isinstance(answer, dict) and answer.get("name") == question.name
    ]
    if len(found) != 1:
        return bad
    answer = found[0]
    if answer.get("type") == "refusal":
        return ChoiceResult(question.name, "refusal")
    allowed = {value for value, _description in question.choices}
    choice = answer.get("choice")
    confidence = answer.get("confidence")
    probabilities = answer.get("probabilities")
    if (
        answer.get("type") != "choice"
        or not isinstance(choice, str)
        or choice not in allowed
        or not _probability(confidence)
        or not isinstance(probabilities, list)
    ):
        return bad
    parsed: dict[str, float] = {}
    for item in probabilities:
        if not isinstance(item, dict):
            return bad
        value, probability = item.get("value"), item.get("probability")
        if (
            not isinstance(value, str)
            or value not in allowed
            or value in parsed
            or not _probability(probability)
        ):
            return bad
        parsed[value] = float(probability)
    if parsed.keys() != allowed:
        return bad
    return ChoiceResult(
        question.name,
        "success",
        choice,
        float(confidence),
        tuple(parsed.items()),
    )


class DecisionsClient:
    """Warm provider client with bounded queued/running work and no retries."""

    def __init__(
        self,
        settings: WorkerSettings,
        client: Any | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.settings = settings
        self.clock = clock
        self._owns_client = client is None
        self._client = client if client is not None else create_decisions(settings)
        self._pool = ThreadPoolExecutor(
            max_workers=settings.engram_scope_router_workers,
            thread_name_prefix="decisions",
        )
        self._slots = BoundedSemaphore(settings.decisions_max_in_flight)
        self._lock = Lock()
        self._closed = False

    @property
    def timeout(self) -> float:
        return (
            self.settings.decisions_timeout_seconds
            or self.settings.engram_scope_router_timeout_seconds
        )

    def submit(
        self,
        context: DecisionContext,
        questions: tuple[ChoiceQuestion, ...] | None = None,
    ) -> Future[DecisionBundle]:
        started = self.clock()
        questions = (scope_question(self.settings),) if questions is None else questions
        names = [question.name for question in questions]
        if not questions or len(names) != len(set(names)):
            return self._ready(questions, "malformed", started)
        serialized = context.serialize(self.settings)
        if serialized is None:
            return self._ready(questions, "input_too_large", started)
        with self._lock:
            if self._closed:
                return self._ready(questions, "unavailable", started)
            if not self._slots.acquire(blocking=False):
                return self._ready(questions, "saturated", started)
            try:
                future = self._pool.submit(
                    self._evaluate,
                    serialized,
                    questions,
                    started,
                )
            except Exception:  # noqa: BLE001 - fail open without logging payloads
                self._slots.release()
                return self._ready(questions, "unavailable", started)
        future.add_done_callback(lambda _future: self._slots.release())
        return future

    def _bundle(
        self,
        questions: tuple[ChoiceQuestion, ...],
        outcome: ChoiceOutcome,
        started: float,
    ) -> DecisionBundle:
        return DecisionBundle(
            tuple(ChoiceResult(q.name, outcome) for q in questions),
            max(0, self.clock() - started) * 1000,
        )

    def _ready(
        self,
        questions: tuple[ChoiceQuestion, ...],
        outcome: ChoiceOutcome,
        started: float,
    ) -> Future[DecisionBundle]:
        future: Future[DecisionBundle] = Future()
        future.set_result(self._bundle(questions, outcome, started))
        return future

    def _evaluate(
        self,
        serialized: str,
        questions: tuple[ChoiceQuestion, ...],
        started: float,
    ) -> DecisionBundle:
        remaining = self.timeout - (self.clock() - started)
        if remaining <= 0:
            return self._bundle(questions, "timeout", started)
        try:
            response = self._client.decisions.create(
                model=self.settings.decisions_model,
                input=serialized,
                questions=[question.wire() for question in questions],
                timeout=remaining,
            )
            if self.clock() - started >= self.timeout:
                return self._bundle(questions, "timeout", started)
            payload = response if isinstance(response, dict) else response.model_dump()
            return DecisionBundle(
                tuple(decode_choice(payload, q) for q in questions),
                max(0, self.clock() - started) * 1000,
            )
        except APITimeoutError:
            return self._bundle(questions, "timeout", started)
        except Exception:  # noqa: BLE001 - provider fault never starves memory
            return self._bundle(questions, "unavailable", started)

    def close(self) -> None:
        with self._lock:
            self._closed = True
        self._pool.shutdown(wait=True, cancel_futures=True)
        if self._owns_client:
            self._client.close()
