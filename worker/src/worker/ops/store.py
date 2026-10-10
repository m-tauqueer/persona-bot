from __future__ import annotations

from uuid import UUID

import psycopg

from worker.ops.decision import OPS_SERVICE_WORKER, parse_ops_service


def insert_ops_event(
    conn: psycopg.Connection,
    *,
    service: str,
    code: str,
    message: str,
    correlation_id: UUID | str | None = None,
) -> str:
    known = parse_ops_service(service)
    if known is None:
        raise ValueError("unknown ops service")
    correlation = str(correlation_id) if correlation_id is not None else None
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops_events (service, code, message, correlation_id)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (known, code, message, correlation),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError("ops event insert returned no row")
    return str(row["id"])


def worker_service_token(raw: str) -> str:
    return parse_ops_service(raw) or OPS_SERVICE_WORKER
