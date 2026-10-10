"""Redis-backed brute-force throttle for the internal-secret guard.

Only *failed* authentications are counted, keyed by client address, so the
public think endpoint and the other internal routes cannot be used to guess the
shared secret at speed. A correct secret is never counted, so legitimate
server-to-server traffic (Deepgram, the gateway) is never throttled even when
many callers share one source address. Fail-open: a missing or unreachable
Redis never blocks a request.
"""

from __future__ import annotations

from typing import Any

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
    close_rate_limit()
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


def register_auth_failure(settings: WorkerSettings, identity: str) -> bool:
    """Count one auth failure for ``identity`` in the current window.

    Returns ``True`` when the caller is now over the configured limit and the
    request should be refused with 429 instead of 401. Never raises.
    """
    if not settings.rate_limit_enabled:
        return False
    client = _redis(settings)
    if client is None:
        return False
    key = f"{settings.rate_limit_redis_prefix}auth-fail:{identity}"
    try:
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, settings.internal_auth_failure_window_seconds)
        return count > settings.internal_auth_max_failures
    except Exception:
        log.warning("auth throttle skipped", reason="redis unavailable")
        return False


def close_rate_limit() -> None:
    global _client, _client_url
    if _client is None:
        return
    try:
        _client.close()
    except Exception:
        log.exception("redis rate-limit client close failed")
    _client = None
    _client_url = None
