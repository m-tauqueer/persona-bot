from __future__ import annotations

from uuid import UUID

import psycopg

from worker.schema import SUBSCRIPTION_ACTIVE


def has_active_subscription(
    conn: psycopg.Connection,
    user_id: UUID,
    persona_id: UUID,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM subscriptions
            WHERE user_id = %s
              AND persona_id = %s
              AND status = %s
            LIMIT 1
            """,
            (str(user_id), str(persona_id), SUBSCRIPTION_ACTIVE),
        )
        return cur.fetchone() is not None


def subscription_status(
    conn: psycopg.Connection,
    user_id: UUID,
    persona_id: UUID,
) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT status
            FROM subscriptions
            WHERE user_id = %s
              AND persona_id = %s
            LIMIT 1
            """,
            (str(user_id), str(persona_id)),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return str(row["status"] if isinstance(row, dict) else row[0])


def upsert_active_subscription(
    conn: psycopg.Connection,
    user_id: UUID,
    persona_id: UUID,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO subscriptions (user_id, persona_id, status)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, persona_id) DO UPDATE
            SET status = EXCLUDED.status
            """,
            (str(user_id), str(persona_id), SUBSCRIPTION_ACTIVE),
        )


def restore_subscription(
    conn: psycopg.Connection,
    user_id: UUID,
    persona_id: UUID,
    *,
    prior_status: str | None,
) -> None:
    """Undo a temporary active mirror used by a probe."""
    with conn.cursor() as cur:
        if prior_status is None:
            cur.execute(
                """
                DELETE FROM subscriptions
                WHERE user_id = %s
                  AND persona_id = %s
                """,
                (str(user_id), str(persona_id)),
            )
            return
        cur.execute(
            """
            UPDATE subscriptions
            SET status = %s
            WHERE user_id = %s
              AND persona_id = %s
            """,
            (prior_status, str(user_id), str(persona_id)),
        )
