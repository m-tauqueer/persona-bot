"""Worker think-endpoint auth, isolation, and OpenAPI exposure. No live brain."""

from __future__ import annotations

import sys
from typing import Any
from uuid import uuid4

import redis
from fastapi.testclient import TestClient

from worker.config import WorkerSettings, load_settings
from worker.main import app
from worker.persistence.db import connect

failed = 0

# Starlette's TestClient reports this as request.client.host.
_TEST_IDENTITY = "testclient"


def check(name: str, ok: bool, detail: str = "") -> None:
    global failed
    extra = f" {detail}" if detail else ""
    if ok:
        print(f"{name}=ok{extra}")
        return
    print(f"{name}=FAIL{extra}", file=sys.stderr)
    failed += 1


def _throttle_client(settings: WorkerSettings) -> Any | None:
    if not settings.rate_limit_enabled or not settings.redis_url:
        return None
    timeout = settings.redis_command_timeout_ms / 1000
    try:
        client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=timeout,
            socket_timeout=timeout,
        )
        client.ping()
        return client
    except Exception:
        return None


def _clear_throttle(client: Any, settings: WorkerSettings) -> None:
    try:
        client.delete(
            f"{settings.rate_limit_redis_prefix}auth-fail:{_TEST_IDENTITY}",
        )
    except Exception:
        pass


def main() -> int:
    settings = load_settings()
    client = TestClient(app)
    path = settings.byo_llm_chat_completions_path
    body = {"messages": [{"role": settings.byo_llm_user_role, "content": "x"}]}
    secret = {settings.internal_secret_header: settings.internal_api_secret}

    # Start from a clean failure count so the 401 assertions below are
    # deterministic across repeated runs; the throttle itself is exercised last.
    throttle = _throttle_client(settings)
    if throttle is not None:
        _clear_throttle(throttle, settings)

    unauth = client.post(path, json=body)
    check("byo_unauth", unauth.status_code == 401, str(unauth.status_code))

    wrong = "0" * len(settings.internal_api_secret)
    if wrong == settings.internal_api_secret:
        wrong = "1" * len(settings.internal_api_secret)
    bad_secret = client.post(
        path,
        headers={settings.internal_secret_header: wrong},
        json=body,
    )
    check(
        "byo_wrong_secret",
        bad_secret.status_code == 401,
        str(bad_secret.status_code),
    )

    turn = client.post("/internal/turn", json={})
    check("internal_turn_unauth", turn.status_code == 401, str(turn.status_code))

    health = client.get("/health")
    check("health_open", health.status_code == 200, str(health.status_code))

    docs = client.get("/docs")
    redoc = client.get("/redoc")
    spec = client.get("/openapi.json")
    if settings.worker_openapi_enabled:
        check("openapi_enabled_docs", docs.status_code == 200, str(docs.status_code))
    else:
        check("openapi_docs_hidden", docs.status_code == 404, str(docs.status_code))
        check("openapi_redoc_hidden", redoc.status_code == 404, str(redoc.status_code))
        check("openapi_spec_hidden", spec.status_code == 404, str(spec.status_code))

    owned = None
    other = None
    conn = connect(settings)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id AS session_id, s.user_id, s.persona_id, u.engram_user_id
                FROM sessions s
                INNER JOIN users u ON u.id = s.user_id
                WHERE s.ended_at IS NULL
                ORDER BY s.started_at DESC
                LIMIT 1
                """,
            )
            owned = cur.fetchone()
            if owned is not None:
                cur.execute(
                    """
                    SELECT id, engram_user_id
                    FROM users
                    WHERE id <> %s
                    ORDER BY created_at
                    LIMIT 1
                    """,
                    (str(owned["user_id"]),),
                )
                other = cur.fetchone()
    finally:
        conn.close()

    if owned is None:
        print("byo_forged_engram_id=SKIP (no session)")
    else:
        forged = client.post(
            path,
            headers={
                **secret,
                settings.byo_llm_app_user_header: str(owned["user_id"]),
                settings.byo_llm_engram_user_header: uuid4().hex,
                settings.byo_llm_persona_header: str(owned["persona_id"]),
                settings.byo_llm_session_header: str(owned["session_id"]),
            },
            json=body,
        )
        check(
            "byo_forged_engram_id",
            forged.status_code == 403,
            str(forged.status_code),
        )

    if owned is None or other is None:
        print("byo_other_user_session=SKIP (needs two app users and a session)")
    else:
        stolen = client.post(
            path,
            headers={
                **secret,
                settings.byo_llm_app_user_header: str(other["id"]),
                settings.byo_llm_engram_user_header: str(other["engram_user_id"]),
                settings.byo_llm_persona_header: str(owned["persona_id"]),
                settings.byo_llm_session_header: str(owned["session_id"]),
            },
            json=body,
        )
        check(
            "byo_other_user_session",
            stolen.status_code == 403,
            str(stolen.status_code),
        )

    memories_unauth = client.post("/internal/memories", json={})
    check(
        "memories_unauth",
        memories_unauth.status_code == 401,
        str(memories_unauth.status_code),
    )

    if owned is None:
        print("memories_forged_engram_id=SKIP (no session)")
    else:
        forged_memories = client.post(
            "/internal/memories",
            headers={**secret},
            json={
                "app_user_id": str(owned["user_id"]),
                "engram_user_id": uuid4().hex,
                "engram_persona_id": str(owned["persona_id"]),
            },
        )
        check(
            "memories_forged_engram_id",
            forged_memories.status_code == 403,
            str(forged_memories.status_code),
        )

    if throttle is None:
        print("internal_auth_throttled=SKIP (rate limit off or redis unreachable)")
    else:
        _clear_throttle(throttle, settings)
        last = None
        for _ in range(settings.internal_auth_max_failures + 1):
            last = client.post(path, json=body)
        check(
            "internal_auth_throttled",
            last is not None and last.status_code == 429,
            str(last.status_code if last is not None else None),
        )
        _clear_throttle(throttle, settings)
        throttle.close()

    if failed:
        print("PROBE_FAIL", file=sys.stderr)
        return 1
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
