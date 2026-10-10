from __future__ import annotations

import secrets
from collections.abc import Callable

import structlog
from fastapi import HTTPException, Request

from worker.config import WorkerSettings
from worker.ratelimit import register_auth_failure

log = structlog.get_logger(__name__)


def require_internal_secret(
    settings: WorkerSettings,
) -> Callable[[Request], None]:
    def _guard(request: Request) -> None:
        provided = request.headers.get(settings.internal_secret_header)
        expected = settings.internal_api_secret
        if provided is not None and _digest_equal(provided, expected):
            return
        identity = request.client.host if request.client else "unknown"
        if register_auth_failure(settings, identity):
            log.warning("internal auth throttled", identity=identity)
            raise HTTPException(status_code=429, detail="too many attempts")
        raise HTTPException(status_code=401, detail="unauthorized")

    return _guard


def _digest_equal(provided: str, expected: str) -> bool:
    if len(provided) != len(expected):
        secrets.compare_digest(expected, expected)
        return False
    return secrets.compare_digest(provided, expected)
