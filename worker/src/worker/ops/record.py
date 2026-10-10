from __future__ import annotations

from uuid import UUID

import structlog

from worker.config import WorkerSettings
from worker.ops.decision import parse_code_list, should_record_ops_code
from worker.ops.store import insert_ops_event, worker_service_token
from worker.persistence.db import borrow
from worker.turn.errors import TurnError

log = structlog.get_logger(__name__)


def record_ops_event(
    settings: WorkerSettings,
    *,
    code: str | None,
    message: str,
    correlation_id: UUID | None = None,
) -> None:
    if code is None:
        return
    if not should_record_ops_code(code, parse_code_list(settings.ops_record_codes)):
        return
    try:
        with borrow(settings) as conn:
            insert_ops_event(
                conn,
                service=worker_service_token(settings.ops_service_worker),
                code=code,
                message=message,
                correlation_id=correlation_id,
            )
            conn.commit()
    except Exception:
        log.warning(settings.ops_log_event, code=code, exc_info=True)


def record_turn_error(
    settings: WorkerSettings,
    exc: TurnError,
    correlation_id: UUID | None,
) -> None:
    record_ops_event(
        settings,
        code=exc.code,
        message=str(exc),
        correlation_id=correlation_id,
    )
