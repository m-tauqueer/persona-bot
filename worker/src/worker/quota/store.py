from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
import structlog

from worker.config import WorkerSettings
from worker.quota.decision import first_quota_hit, quota_should_warn
from worker.quota.settings import QuotaLimits, env_quota_limits, resolve_quota_limits
from worker.schema import SESSION_CHANNEL_VOICE, TURN_SPEAKER_USER

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class QuotaUsage:
    turns_used: int
    minutes_used: float
    reset_at: datetime


def _window(conn: psycopg.Connection, timezone_name: str) -> tuple[datetime, datetime]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              (date_trunc('day', timezone(%s, now())) AT TIME ZONE %s) AS window_start,
              (
                date_trunc('day', timezone(%s, now())) AT TIME ZONE %s
                + interval '1 day'
              ) AS reset_at
            """,
            (timezone_name, timezone_name, timezone_name, timezone_name),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError("quota window query returned no row")
    return row["window_start"], row["reset_at"]


def load_quota_settings(conn: psycopg.Connection) -> QuotaLimits | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT turns_per_day, voice_minutes_per_day, timezone, warn_ratio
            FROM quota_settings
            WHERE singleton
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if row is None:
        return None
    return QuotaLimits(
        turns_per_day=int(row["turns_per_day"]),
        voice_minutes_per_day=float(row["voice_minutes_per_day"]),
        timezone=str(row["timezone"]),
        warn_ratio=float(row["warn_ratio"]),
    )


def resolve_live_quota_limits(
    conn: psycopg.Connection,
    settings: WorkerSettings,
) -> QuotaLimits:
    return resolve_quota_limits(load_quota_settings(conn), env_quota_limits(settings))


def load_quota_usage(
    conn: psycopg.Connection,
    user_id: UUID,
    limits: QuotaLimits,
) -> QuotaUsage:
    start, reset_at = _window(conn, limits.timezone)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*)::int AS turns_used
            FROM turns t
            INNER JOIN sessions s ON s.id = t.session_id
            WHERE s.user_id = %s
              AND t.speaker = %s
              AND t.created_at >= %s
              AND t.created_at < %s
            """,
            (str(user_id), TURN_SPEAKER_USER, start, reset_at),
        )
        turns_row = cur.fetchone()
        cur.execute(
            """
            SELECT COALESCE(
              SUM(
                GREATEST(
                  0,
                  EXTRACT(
                    EPOCH FROM (
                      LEAST(COALESCE(s.ended_at, now()), %s)
                      - GREATEST(s.started_at, %s)
                    )
                  )
                )
              ),
              0
            ) / 60.0 AS minutes_used
            FROM sessions s
            WHERE s.user_id = %s
              AND s.channel = %s
              AND s.started_at < %s
              AND COALESCE(s.ended_at, now()) > %s
            """,
            (reset_at, start, str(user_id), SESSION_CHANNEL_VOICE, reset_at, start),
        )
        minutes_row = cur.fetchone()
    turns_used = int(turns_row["turns_used"]) if turns_row else 0
    minutes_used = float(minutes_row["minutes_used"]) if minutes_row else 0.0
    return QuotaUsage(
        turns_used=turns_used,
        minutes_used=minutes_used,
        reset_at=reset_at,
    )


def log_quota_warn(
    settings: WorkerSettings,
    user_id: UUID,
    usage: QuotaUsage,
    limits: QuotaLimits,
) -> None:
    if quota_should_warn(usage.turns_used, limits.turns_per_day, limits.warn_ratio):
        log.warning(
            settings.quota_log_warn,
            user_id=str(user_id),
            kind=settings.quota_kind_turns,
            used=usage.turns_used,
            limit=limits.turns_per_day,
            ratio=limits.warn_ratio,
        )
    if quota_should_warn(
        usage.minutes_used,
        limits.voice_minutes_per_day,
        limits.warn_ratio,
    ):
        log.warning(
            settings.quota_log_warn,
            user_id=str(user_id),
            kind=settings.quota_kind_minutes,
            used=usage.minutes_used,
            limit=limits.voice_minutes_per_day,
            ratio=limits.warn_ratio,
        )


def refuse_quota(
    settings: WorkerSettings,
    usage: QuotaUsage,
    limits: QuotaLimits,
) -> dict[str, Any] | None:
    hit = first_quota_hit(
        turns_used=usage.turns_used,
        turns_limit=limits.turns_per_day,
        turns_kind=settings.quota_kind_turns,
        minutes_used=usage.minutes_used,
        minutes_limit=limits.voice_minutes_per_day,
        minutes_kind=settings.quota_kind_minutes,
    )
    if hit is None:
        return None
    if hit == settings.quota_kind_turns:
        return {
            "error": settings.quota_error_turns,
            "code": settings.quota_code_turns,
            "kind": settings.quota_kind_turns,
            "used": usage.turns_used,
            "limit": limits.turns_per_day,
        }
    return {
        "error": settings.quota_error_minutes,
        "code": settings.quota_code_minutes,
        "kind": settings.quota_kind_minutes,
        "used": usage.minutes_used,
        "limit": limits.voice_minutes_per_day,
    }
