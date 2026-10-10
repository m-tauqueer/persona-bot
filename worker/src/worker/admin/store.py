from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from worker.admin.errors import AdminError
from worker.config import WorkerSettings

PersonaRow = dict[str, Any]
UserRow = dict[str, Any]


def connect(settings: WorkerSettings) -> psycopg.Connection:
    return psycopg.connect(settings.database_url, row_factory=dict_row)


def list_personas(conn: psycopg.Connection) -> list[PersonaRow]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, engram_persona_id, handle, display_name, description,
                   voice_config, published, created_at, updated_at
            FROM personas
            ORDER BY created_at
            """,
        )
        return list(cur.fetchall())


def pick_single_persona(
    rows: list[PersonaRow],
    *,
    error: str,
) -> PersonaRow | None:
    if len(rows) == 0:
        return None
    if len(rows) == 1:
        return rows[0]
    raise AdminError(
        error,
        status=409,
        reason="persona_pin_required",
    )


def pick_probe_persona(
    rows: list[PersonaRow],
    *,
    persona_id: str | None = None,
) -> PersonaRow | None:
    """One published persona for a probe to talk to.

    A probe exercises the turn path, not the catalog, so a second persona must
    not break it: without a pin it takes the oldest published row. `rows` is
    expected in `created_at` order. `PROBE_PERSONA_ID` pins a specific published
    row; an unpublished or missing pin yields None so the probe fails closed.
    """
    if persona_id:
        wanted = str(persona_id)
        for row in rows:
            if str(row["id"]) == wanted and row.get("published") is True:
                return row
        return None
    for row in rows:
        if row.get("published") is True:
            return row
    return None


def probe_persona(
    conn: psycopg.Connection,
    settings: WorkerSettings,
) -> PersonaRow | None:
    return pick_probe_persona(
        list_personas(conn),
        persona_id=settings.probe_persona_id,
    )


def write_probe_persona(
    conn: psycopg.Connection,
    settings: WorkerSettings,
) -> PersonaRow | None:
    """Persona for probes that write to Engram.

    Requires `PROBE_PERSONA_ID`. Unset means None so the caller skips instead
    of falling through to the oldest published (member-facing) row.
    """
    if not settings.probe_persona_id:
        return None
    return probe_persona(conn, settings)


def get_persona(conn: psycopg.Connection, persona_id: str) -> PersonaRow | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, engram_persona_id, handle, display_name, description,
                   voice_config, published, created_at, updated_at
            FROM personas
            WHERE id = %s
            """,
            (str(persona_id),),
        )
        return cur.fetchone()


def set_persona_published(
    conn: psycopg.Connection,
    persona_id: str,
    published: bool,
) -> PersonaRow | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE personas
            SET published = %s, updated_at = now()
            WHERE id = %s
            RETURNING id, engram_persona_id, handle, display_name, description,
                      voice_config, published, created_at, updated_at
            """,
            (published, str(persona_id)),
        )
        row = cur.fetchone()
    conn.commit()
    return row


def delete_persona_cascade(
    conn: psycopg.Connection,
    persona_id: str,
) -> dict[str, int]:
    """Remove a persona and the local record of every sitting under it.

    `sessions.persona_id` and `subscriptions.persona_id` are ON DELETE RESTRICT,
    so both go first; turns and their spans, memory refs and audio rows follow
    by cascade. One transaction: a persona row must never outlive its sittings
    or the reverse.
    """
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM subscriptions WHERE persona_id = %s RETURNING id",
            (str(persona_id),),
        )
        subscriptions = len(cur.fetchall())
        cur.execute(
            "DELETE FROM sessions WHERE persona_id = %s RETURNING id",
            (str(persona_id),),
        )
        sessions = len(cur.fetchall())
        cur.execute(
            "DELETE FROM personas WHERE id = %s RETURNING id",
            (str(persona_id),),
        )
        personas = len(cur.fetchall())
    conn.commit()
    return {
        "subscriptions": subscriptions,
        "sessions": sessions,
        "personas": personas,
    }


def upsert_persona(
    conn: psycopg.Connection,
    *,
    engram_persona_id: str,
    handle: str,
    display_name: str,
    description: str | None,
    voice_config: dict[str, Any],
    published: bool | None = None,
) -> PersonaRow:
    insert_published = False if published is None else published
    update_published = published is not None
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO personas (
                  engram_persona_id, handle, display_name, description,
                  voice_config, published
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (engram_persona_id) DO UPDATE
                SET handle = EXCLUDED.handle,
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    voice_config = EXCLUDED.voice_config,
                    published = CASE
                      WHEN %s THEN EXCLUDED.published
                      ELSE personas.published
                    END,
                    updated_at = now()
                RETURNING id, engram_persona_id, handle, display_name, description,
                          voice_config, published, created_at, updated_at
                """,
                (
                    engram_persona_id,
                    handle,
                    display_name,
                    description,
                    Json(voice_config),
                    insert_published,
                    update_published,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    except psycopg.errors.UniqueViolation as exc:
        conn.rollback()
        raise AdminError(
            "handle is already used by another persona",
            status=409,
            reason="handle_conflict",
        ) from exc
    if row is None:
        raise AdminError("persona upsert returned no row", status=500)
    return row


def find_user(conn: psycopg.Connection, identifier: str) -> UserRow | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, google_sub, email, engram_user_id
            FROM users
            WHERE email = %s
               OR id::text = %s
               OR engram_user_id = %s
            """,
            (identifier, identifier, identifier),
        )
        return cur.fetchone()


def set_engram_user_id(
    conn: psycopg.Connection,
    user_id: str,
    engram_user_id: str,
    *,
    member_secret: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE users
            SET engram_user_id = %s,
                engram_member_secret = COALESCE(%s, engram_member_secret)
            WHERE id = %s
            """,
            (engram_user_id, member_secret, user_id),
        )
    conn.commit()


def upsert_subscription(
    conn: psycopg.Connection,
    *,
    user_id: str,
    persona_id: str,
    status: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO subscriptions (user_id, persona_id, status)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, persona_id) DO UPDATE
            SET status = EXCLUDED.status
            """,
            (user_id, persona_id, status),
        )
    conn.commit()


def list_subscriptions(
    conn: psycopg.Connection,
    persona_id: str,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.status, s.created_at,
                   u.id AS user_id, u.email, u.engram_user_id
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            WHERE s.persona_id = %s
            ORDER BY s.created_at
            """,
            (persona_id,),
        )
        return list(cur.fetchall())
