from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

PersonaRow = dict[str, Any]


def get_persona(conn: psycopg.Connection, persona_id: UUID) -> PersonaRow | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, engram_persona_id, handle, display_name, description,
                   voice_config, published
            FROM personas
            WHERE id = %s
            """,
            (str(persona_id),),
        )
        return cur.fetchone()


def visible_to_members(row: PersonaRow | None) -> PersonaRow | None:
    if row is None:
        return None
    if row.get("published") is not True:
        return None
    return row


def persona_id_for_engram(
    conn: psycopg.Connection,
    engram_persona_id: str,
) -> UUID | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM personas WHERE engram_persona_id = %s",
            (engram_persona_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return UUID(str(row["id"]))
