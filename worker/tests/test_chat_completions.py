from __future__ import annotations

from uuid import uuid4

import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient

from worker.api.chat_completions import build_chat_completions_router
from worker.config import WorkerSettings
from worker.controller.decision import Action, Decision, ReasonCode
from worker.observe.fields import turn_log_fields
from worker.turn.service import TurnPlan, TurnResult


def test_duplicate_session_id_kwarg_is_the_think_crash(
    settings: WorkerSettings,
) -> None:
    fields = turn_log_fields(
        settings,
        {
            "correlation_id": str(uuid4()),
            "session_id": str(uuid4()),
        },
    )
    with pytest.raises(TypeError, match="session_id"):
        structlog.get_logger("test").info(
            "voice turn requested",
            session_id=fields["session_id"],
            **fields,
        )


def test_voice_request_log_kwargs_do_not_collide(settings: WorkerSettings) -> None:
    extras = {
        "stream_requested": True,
        "streaming": True,
        "messages": 1,
        "has_text": True,
        **turn_log_fields(
            settings,
            {
                "correlation_id": str(uuid4()),
                "session_id": str(uuid4()),
            },
        ),
    }
    structlog.get_logger("test").info("voice turn requested", **extras)
    assert "session_id" in extras


class _SilenceRunner:
    def begin(self, **kwargs: object) -> TurnPlan:
        session_id = kwargs["session_id"]
        if not hasattr(session_id, "hex"):
            raise TypeError("session_id must be a UUID")
        return TurnPlan(
            session_id=session_id,
            text=str(kwargs.get("text") or ""),
            started=0.0,
            decision=Decision(
                action=Action.SILENCE,
                reasons=(ReasonCode.EMPTY_INPUT,),
                hints={},
            ),
            prior_sid=None,
            persona_identity={},
            voice_config={},
            history=[],
            correlation_id=uuid4(),
        )

    def finish(self, plan: TurnPlan) -> TurnResult:
        return TurnResult(
            action=plan.decision.action.value,
            reply_text=None,
            session_id=plan.session_id,
            engram_session_id=None,
            turn_ids=[],
            reasons=[reason.value for reason in plan.decision.reasons],
            correlation_id=plan.correlation_id,
        )


def test_think_does_not_500_after_begin(settings: WorkerSettings) -> None:
    app = FastAPI()
    app.include_router(build_chat_completions_router(settings, _SilenceRunner()))
    client = TestClient(app, raise_server_exceptions=True)
    session_id = uuid4()
    response = client.post(
        settings.byo_llm_chat_completions_path,
        headers={
            settings.internal_secret_header: settings.internal_api_secret,
            settings.byo_llm_app_user_header: str(uuid4()),
            settings.byo_llm_persona_header: str(uuid4()),
            settings.byo_llm_session_header: str(session_id),
            settings.byo_llm_engram_user_header: "engram-user",
        },
        json={"messages": [{"role": "user", "content": "hello"}], "stream": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["choices"][0]["message"]["content"] == ""
