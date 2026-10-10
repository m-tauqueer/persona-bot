from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from worker.api.http import raise_turn, read_correlation_id
from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings
from worker.ops.record import record_ops_event, record_turn_error
from worker.turn.errors import TurnError
from worker.turn.service import TurnRunner


class TurnIn(BaseModel):
    app_user_id: UUID
    engram_user_id: str = Field(min_length=1)
    persona_id: UUID
    session_id: UUID
    text: str = Field(min_length=1)


class TurnOut(BaseModel):
    action: str
    reply_text: str | None
    session_id: UUID
    engram_session_id: str | None
    turn_ids: list[UUID]
    reasons: list[str]
    correlation_id: UUID
    recorded: bool = True
    warning: str | None = None
    warning_code: str | None = None


def build_turn_router(
    settings: WorkerSettings,
    runner: TurnRunner | None = None,
) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(dependencies=[Depends(guard)])
    runner = runner or TurnRunner(settings)

    @router.post("/internal/turn", response_model=TurnOut)
    def turn(request: Request, body: TurnIn) -> TurnOut:
        correlation_id = read_correlation_id(request, settings)
        try:
            result = runner.run(
                app_user_id=body.app_user_id,
                engram_user_id=body.engram_user_id,
                persona_id=body.persona_id,
                session_id=body.session_id,
                text=body.text,
                correlation_id=correlation_id,
            )
        except TurnError as exc:
            record_turn_error(settings, exc, correlation_id)
            raise_turn(exc)
        if result.warning_code:
            record_ops_event(
                settings,
                code=result.warning_code,
                message=result.warning or "",
                correlation_id=result.correlation_id,
            )
        return TurnOut(
            action=result.action,
            reply_text=result.reply_text,
            session_id=result.session_id,
            engram_session_id=result.engram_session_id,
            turn_ids=result.turn_ids,
            reasons=result.reasons,
            correlation_id=result.correlation_id,
            recorded=result.recorded,
            warning=result.warning,
            warning_code=result.warning_code,
        )

    return router
