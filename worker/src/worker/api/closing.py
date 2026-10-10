from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings
from worker.turn.service import TurnRunner


class ClosingIn(BaseModel):
    session_id: UUID
    app_user_id: UUID


class ClosingOut(BaseModel):
    accepted: bool


def build_closing_router(
    settings: WorkerSettings,
    runner: TurnRunner,
) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post(
        settings.internal_closing_path,
        response_model=ClosingOut,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def closing_pass(body: ClosingIn) -> ClosingOut:
        runner.enqueue_closing_pass(body.session_id, body.app_user_id)
        return ClosingOut(accepted=True)

    return router
