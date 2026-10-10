from __future__ import annotations

from typing import NoReturn
from uuid import UUID

import structlog
from fastapi import HTTPException, Request

from worker.config import WorkerSettings
from worker.turn.errors import TurnError

log = structlog.get_logger(__name__)


def raise_turn(exc: TurnError) -> NoReturn:
    if exc.status in {401, 403, 429}:
        log.warning(
            "turn refused",
            status=exc.status,
            reason=exc.reason,
            code=exc.code,
        )
    detail: dict[str, object] = {
        "error": str(exc),
        "reason": exc.reason,
        "code": exc.code,
    }
    if exc.reset_at is not None:
        stamp = exc.reset_at.isoformat().replace("+00:00", "Z")
        detail["reset_at"] = stamp
    raise HTTPException(status_code=exc.status, detail=detail) from exc


def read_correlation_id(
    request: Request,
    settings: WorkerSettings,
) -> UUID | None:
    raw = request.headers.get(settings.correlation_id_header)
    if raw is None or not raw.strip():
        return None
    try:
        return UUID(raw.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid correlation header"},
        ) from exc
