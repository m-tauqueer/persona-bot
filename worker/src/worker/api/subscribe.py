from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings
from worker.engram.engram_brain import EngramBrain
from worker.turn.grant import grant_persona_access


class SubscribeIn(BaseModel):
    engram_user_id: str = Field(min_length=1)
    persona_id: str = Field(min_length=1)


class SubscribeOut(BaseModel):
    subscribed: bool
    reason: str | None = None


def build_subscribe_router(settings: WorkerSettings) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post("/internal/subscribe", response_model=SubscribeOut)
    def subscribe(body: SubscribeIn) -> SubscribeOut:
        if (
            not settings.engram_api_key
            or not settings.engram_org_id
            or settings.engram_base_url is None
        ):
            return SubscribeOut(subscribed=False, reason="engram_not_configured")

        brain = EngramBrain(settings, "")
        try:
            granted = grant_persona_access(
                brain,
                settings,
                engram_persona_id=body.persona_id,
                engram_user_id=body.engram_user_id,
            )
            if granted.subscribed:
                return SubscribeOut(subscribed=True, reason=granted.reason)
            return SubscribeOut(subscribed=False, reason=granted.reason)
        finally:
            brain.close()

    return router
