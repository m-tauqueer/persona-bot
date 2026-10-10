from worker.config import WorkerSettings
from worker.controller.controller import Controller
from worker.controller.decision import Action, ReasonCode, TurnSignals
from worker.engram.errors import (
    ConflictError,
    ForbiddenError,
    NotSubscribedError,
    ServerError,
    ValidationError,
)
from worker.turn.grant import grant_persona_access, should_attempt_grant


class FakeGrantBrain:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.error = error

    def subscribe(self, persona_id: str, user_id: str) -> dict[str, bool]:
        self.calls.append((persona_id, user_id))
        if self.error is not None:
            raise self.error
        return {"subscribed": True}


def test_first_talk_attempts_grant() -> None:
    assert should_attempt_grant(mirrored=False, already_tried=False) is True


def test_mirrored_or_already_tried_skips_grant() -> None:
    assert should_attempt_grant(mirrored=True, already_tried=False) is False
    assert should_attempt_grant(mirrored=False, already_tried=True) is False
    assert should_attempt_grant(mirrored=True, already_tried=True) is False


def test_grant_success_mirrors(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain()
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-ada",
        engram_user_id="user-1",
    )
    assert granted.subscribed is True
    assert granted.mirror is True
    assert granted.reason is None
    assert brain.calls == [("eng-ada", "user-1")]


def test_grant_sends_hyphenless_uuid_hex(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain()
    hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4"
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-ada",
        engram_user_id=hyphenated,
    )
    assert granted.subscribed is True
    assert brain.calls == [("eng-ada", "3a07018eb5c2483ab80f07e90488b5f4")]


def test_grant_already_subscribed_still_mirrors(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain(ConflictError("exists", status=409))
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-ada",
        engram_user_id="user-1",
    )
    assert granted.subscribed is True
    assert granted.mirror is True
    assert granted.reason == "already"


def test_grant_forbidden_does_not_subscribe(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain(ForbiddenError("missing org:manage", status=403))
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-ada",
        engram_user_id="user-1",
    )
    assert granted.subscribed is False
    assert granted.mirror is False
    assert granted.reason == "forbidden"


def test_grant_validation_signals_retry_join(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain(ValidationError("not a member", status=422))
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-ada",
        engram_user_id="user-1",
    )
    assert granted.subscribed is False
    assert granted.reason == "validation"
    assert granted.status == 422


def test_grant_brain_error_does_not_subscribe(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain(ServerError("down", status=503))
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-nova",
        engram_user_id="user-2",
    )
    assert granted.subscribed is False
    assert granted.mirror is False
    assert granted.reason == "brain_error"


def test_grant_unexpected_error_does_not_subscribe(settings: WorkerSettings) -> None:
    brain = FakeGrantBrain(RuntimeError("boom"))
    granted = grant_persona_access(
        brain,
        settings,
        engram_persona_id="eng-ada",
        engram_user_id="user-1",
    )
    assert granted.subscribed is False
    assert granted.mirror is False
    assert granted.reason == "error"


def test_retrieve_or_chat_not_subscribed_fails_closed() -> None:
    inbound = TurnSignals(has_inbound_text=True)
    controller = Controller()
    chat = controller.decide(NotSubscribedError("no", status=403), inbound)
    retrieve = controller.decide(ForbiddenError("no", status=403), inbound)
    assert chat.action is Action.SILENCE
    assert chat.reasons == (ReasonCode.NOT_SUBSCRIBED,)
    assert retrieve.action is Action.SILENCE
    assert retrieve.reasons == (ReasonCode.FORBIDDEN,)
