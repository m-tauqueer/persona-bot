from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import redis
import structlog

from worker.config import WorkerSettings

log = structlog.get_logger(__name__)

_client: Any | None = None
_client_url: str | None = None


def _redis(settings: WorkerSettings) -> Any | None:
    global _client, _client_url
    if not settings.redis_url:
        return None
    if _client is not None and _client_url == settings.redis_url:
        return _client
    close_notices()
    timeout = settings.redis_command_timeout_ms / 1000
    _client = redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=timeout,
        socket_timeout=timeout,
        retry_on_timeout=False,
    )
    _client_url = settings.redis_url
    return _client


def notice_payload(session_id: UUID, code: str, message: str) -> str:
    return json.dumps(
        {
            "session_id": str(session_id),
            "code": code,
            "message": message,
        }
    )


def publish_notice(
    settings: WorkerSettings,
    session_id: UUID,
    code: str,
    message: str,
) -> None:
    """Tell the gateway a voice turn failed. Never raises."""
    body = notice_payload(session_id, code, message)
    _publish(settings, session_id, code, body)


def publish_trace(
    settings: WorkerSettings,
    session_id: UUID,
    correlation_id: UUID,
    turn_ids: list[UUID],
) -> None:
    """Tell the gateway the id that joins this turn's logs to its row."""
    body = json.dumps(
        {
            "session_id": str(session_id),
            "code": settings.voice_notice_trace_code,
            "message": settings.voice_notice_trace_message,
            "kind": settings.voice_notice_kind_trace,
            "correlation_id": str(correlation_id),
            "turn_ids": [str(turn_id) for turn_id in turn_ids],
        },
    )
    _publish(settings, session_id, settings.voice_notice_trace_code, body)


def _publish(
    settings: WorkerSettings,
    session_id: UUID,
    code: str,
    body: str,
) -> None:
    try:
        client = _redis(settings)
        if client is None:
            log.warning(
                "voice notice not sent",
                session_id=str(session_id),
                code=code,
                reason="REDIS_URL is not set",
            )
            return
        client.publish(settings.voice_notice_redis_channel, body)
    except Exception:
        log.exception(
            "voice notice not sent",
            session_id=str(session_id),
            code=code,
        )


def close_notices() -> None:
    global _client, _client_url
    if _client is None:
        return
    try:
        _client.close()
    except Exception:
        log.exception("redis notice client close failed")
    _client = None
    _client_url = None
