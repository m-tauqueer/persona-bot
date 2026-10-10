from __future__ import annotations

from uuid import UUID

import psycopg


def claim_write_receipt(
    conn: psycopg.Connection,
    session_id: UUID,
    correlation_id: UUID,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO write_receipts (session_id, correlation_id)
            VALUES (%s, %s)
            ON CONFLICT (session_id, correlation_id) DO NOTHING
            RETURNING session_id
            """,
            (str(session_id), str(correlation_id)),
        )
        return cur.fetchone() is not None


def load_receipt_turn_ids(
    conn: psycopg.Connection,
    session_id: UUID,
    correlation_id: UUID,
) -> list[UUID]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT user_turn_id, persona_turn_id
            FROM write_receipts
            WHERE session_id = %s AND correlation_id = %s
            """,
            (str(session_id), str(correlation_id)),
        )
        row = cur.fetchone()
    if row is None:
        return []
    ids: list[UUID] = []
    if row["user_turn_id"] is not None:
        ids.append(row["user_turn_id"])
    if row["persona_turn_id"] is not None:
        ids.append(row["persona_turn_id"])
    return ids


def store_receipt_turn_ids(
    conn: psycopg.Connection,
    session_id: UUID,
    correlation_id: UUID,
    user_turn_id: UUID,
    persona_turn_id: UUID | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE write_receipts
            SET
              user_turn_id = %s,
              persona_turn_id = %s
            WHERE session_id = %s AND correlation_id = %s
            """,
            (
                str(user_turn_id),
                str(persona_turn_id) if persona_turn_id is not None else None,
                str(session_id),
                str(correlation_id),
            ),
        )


def claim_writeback(
    conn: psycopg.Connection,
    session_id: UUID,
    correlation_id: UUID,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE write_receipts
            SET writeback_at = now()
            WHERE session_id = %s
              AND correlation_id = %s
              AND writeback_at IS NULL
            RETURNING session_id
            """,
            (str(session_id), str(correlation_id)),
        )
        return cur.fetchone() is not None


def claim_closing_pass(
    conn: psycopg.Connection,
    session_id: UUID,
    app_user_id: UUID,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sessions
            SET closing_pass_at = now()
            WHERE id = %s
              AND user_id = %s
              AND ended_at IS NOT NULL
              AND closing_pass_at IS NULL
            RETURNING id
            """,
            (str(session_id), str(app_user_id)),
        )
        return cur.fetchone() is not None
