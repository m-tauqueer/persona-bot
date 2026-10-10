from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from worker.api.http import raise_turn
from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings
from worker.engram.errors import BrainError
from worker.turn.errors import TurnError
from worker.turn.service import TurnRunner


class MemoriesIn(BaseModel):
    app_user_id: UUID
    engram_user_id: str = Field(min_length=1)
    engram_persona_id: str = Field(min_length=1)


def build_memories_router(
    settings: WorkerSettings,
    runner: TurnRunner | None = None,
) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(dependencies=[Depends(guard)])
    runner = runner or TurnRunner(settings)

    @router.post("/internal/memories")
    def memories(body: MemoriesIn) -> dict[str, Any]:
        try:
            hits = runner.retrieve_memories(
                app_user_id=body.app_user_id,
                engram_user_id=body.engram_user_id,
                engram_persona_id=body.engram_persona_id,
            )
        except TurnError as exc:
            raise_turn(exc)
        except BrainError as exc:
            status = exc.status if exc.status is not None else 502
            raise HTTPException(
                status_code=status,
                detail={"error": str(exc)},
            ) from exc
        return {"memories": hits}

    return router
