from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

from worker.engram.user_id import persona_engine_user_ids

SessionRow = dict[str, Any]


def get_session(
    conn: psycopg.Connection,
    session_id: UUID,
    *,
    for_update: bool = False,
) -> SessionRow | None:
    query = """
        SELECT id, user_id, persona_id, engram_session_id, channel,
               started_at, ended_at, closing_pass_at
        FROM sessions
        WHERE id = %s
    """
    if for_update:
        query = f"{query} FOR UPDATE"
    with conn.cursor() as cur:
        cur.execute(query, (str(session_id),))
        return cur.fetchone()


def create_session(
    conn: psycopg.Connection,
    *,
    user_id: UUID,
    persona_id: UUID,
    channel: str,
) -> SessionRow:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sessions (user_id, persona_id, channel)
            VALUES (%s, %s, %s)
            RETURNING id, user_id, persona_id, engram_session_id, channel,
                      started_at, ended_at
            """,
            (str(user_id), str(persona_id), channel),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError("session insert returned no row")
    return row


def set_engram_session_id(
    conn: psycopg.Connection,
    session_id: UUID,
    engram_session_id: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sessions
            SET engram_session_id = %s
            WHERE id = %s
            """,
            (engram_session_id, str(session_id)),
        )


def user_engram_member_secret(
    conn: psycopg.Connection,
    user_id: UUID,
) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT engram_member_secret FROM users WHERE id = %s",
            (str(user_id),),
        )
        row = cur.fetchone()
    if row is None:
        return None
    value = row["engram_member_secret"]
    return value if isinstance(value, str) and value else None


def user_engram_id(conn: psycopg.Connection, user_id: UUID) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT engram_user_id FROM users WHERE id = %s",
            (str(user_id),),
        )
        row = cur.fetchone()
    if row is None:
        return None
    value = row["engram_user_id"]
    return value if isinstance(value, str) else None


def set_user_engram_id(
    conn: psycopg.Connection,
    user_id: UUID,
    engram_user_id: str,
    *,
    member_secret: str | None = None,
) -> None:
    """Write People id and optional encrypted credential in one statement.

    ``member_secret`` None leaves an existing ciphertext in place (COALESCE),
    so a later 409 lookup cannot wipe a secret we already hold.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE users
            SET engram_user_id = %s,
                engram_member_secret = COALESCE(%s, engram_member_secret)
            WHERE id = %s
            """,
            (engram_user_id, member_secret, str(user_id)),
        )


def user_email(conn: psycopg.Connection, user_id: UUID) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE id = %s", (str(user_id),))
        row = cur.fetchone()
    if row is None:
        return None
    value = row["email"]
    return value if isinstance(value, str) else None


def user_id_for_engram(
    conn: psycopg.Connection,
    engram_user_id: str,
) -> UUID | None:
    candidates = list(persona_engine_user_ids(engram_user_id))
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM users WHERE engram_user_id = ANY(%s)",
            (candidates,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return UUID(str(row["id"]))
