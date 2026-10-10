from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings
from worker.lifecycle.purge import purge_private_pool
from worker.persistence.db import borrow
from worker.persistence.personas import persona_id_for_engram
from worker.persistence.sessions import user_id_for_engram
from worker.turn.service import TurnRunner

log = structlog.get_logger(__name__)


class PurgeIn(BaseModel):
    engram_user_id: str = Field(min_length=1)
    engram_persona_id: str = Field(min_length=1)


class PurgeOut(BaseModel):
    engram: str
    forgotten: int
    unsubscribed: bool


def build_lifecycle_router(
    settings: WorkerSettings,
    runner: TurnRunner,
) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post("/internal/lifecycle/purge", response_model=PurgeOut)
    def purge(body: PurgeIn) -> PurgeOut:
        result = purge_private_pool(
            settings,
            engram_user_id=body.engram_user_id,
            engram_persona_id=body.engram_persona_id,
        )
        # Drop the in-memory JWT even when the remote purge was partial or
        # skipped, so a live worker cannot keep writing as this member.
        runner.forget_member_session(body.engram_user_id)
        # Invalidate even when forget/unsubscribe was partial or skipped, so a
        # later turn re-subscribes without a worker restart.
        try:
            with borrow(settings) as conn:
                app_user_id = user_id_for_engram(conn, body.engram_user_id)
                persona_id = persona_id_for_engram(conn, body.engram_persona_id)
            if app_user_id is not None:
                runner.forget_grant_attempts(
                    app_user_id=app_user_id,
                    persona_id=persona_id,
                )
        except Exception:
            log.exception("grant cache not invalidated after purge")
            runner.forget_grant_attempts_all()
        return PurgeOut(
            engram=str(result["engram"]),
            forgotten=int(result["forgotten"]),
            unsubscribed=bool(result["unsubscribed"]),
        )

    return router
