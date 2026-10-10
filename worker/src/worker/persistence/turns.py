from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Json

from worker.reframe.types import HistoryTurn

TurnRow = dict[str, Any]


def next_ordinal(conn: psycopg.Connection, session_id: UUID) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(MAX(ordinal), 0) + 1 AS next
            FROM turns
            WHERE session_id = %s
            """,
            (str(session_id),),
        )
        row = cur.fetchone()
    if row is None:
        return 1
    return int(row["next"])


def insert_turn(
    conn: psycopg.Connection,
    *,
    session_id: UUID,
    ordinal: int,
    speaker: str,
    text: str,
    messages: list[str] | None = None,
    controller_action: str | None = None,
    controller_reasons: list[str] | None = None,
    brain_mode: str | None = None,
    correlation_id: UUID | None = None,
) -> UUID:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO turns (
              session_id, ordinal, speaker, text, messages,
              controller_action, controller_reasons, brain_mode, correlation_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                str(session_id),
                ordinal,
                speaker,
                text,
                Json(messages) if messages is not None else None,
                controller_action,
                Json(controller_reasons) if controller_reasons is not None else None,
                brain_mode,
                str(correlation_id) if correlation_id is not None else None,
            ),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError("turn insert returned no row")
    return row["id"]


def insert_memory_refs(
    conn: psycopg.Connection,
    *,
    turn_id: UUID,
    memories_used: list[Any],
    engram_session_id: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO memory_refs (turn_id, memories_used, engram_session_id)
            VALUES (%s, %s, %s)
            """,
            (str(turn_id), Json(memories_used), engram_session_id),
        )


def insert_latency_spans(
    conn: psycopg.Connection,
    *,
    turn_id: UUID,
    brain_ms: int | None,
    reframe_ms: int | None,
    reframe_first_token_ms: int | None = None,
    total_ms: int | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO latency_spans (
              turn_id, brain_ms, reframe_ms, reframe_first_token_ms, total_ms
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                str(turn_id),
                brain_ms,
                reframe_ms,
                reframe_first_token_ms,
                total_ms,
            ),
        )


def recent_history(
    conn: psycopg.Connection,
    session_id: UUID,
    limit: int,
) -> list[HistoryTurn]:
    if limit <= 0:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT speaker, text
            FROM turns
            WHERE session_id = %s
            ORDER BY ordinal DESC
            LIMIT %s
            """,
            (str(session_id), limit),
        )
        rows = list(cur.fetchall())
    rows.reverse()
    history: list[HistoryTurn] = []
    for row in rows:
        speaker = row["speaker"]
        text = row["text"]
        if isinstance(speaker, str) and isinstance(text, str):
            history.append(HistoryTurn(speaker=speaker, text=text))
    return history


def cap_sitting(
    turns: list[HistoryTurn],
    *,
    max_turns: int,
    max_bytes: int,
) -> list[HistoryTurn]:
    """Keep the newest turns that fit the turn and byte budgets.

    Byte size is UTF-8 length of stored text, not language understanding.
    """
    if max_turns <= 0 or max_bytes <= 0:
        return []
    window = turns[-max_turns:]
    sizes = [len(turn.text.encode("utf-8")) for turn in window]
    total = sum(sizes)
    drop = 0
    while drop < len(window) and total > max_bytes:
        total -= sizes[drop]
        drop += 1
    return window[drop:]


def sitting_history(
    conn: psycopg.Connection,
    session_id: UUID,
    *,
    max_turns: int,
    max_bytes: int,
) -> list[HistoryTurn]:
    loaded = recent_history(conn, session_id, max_turns)
    return cap_sitting(loaded, max_turns=max_turns, max_bytes=max_bytes)
