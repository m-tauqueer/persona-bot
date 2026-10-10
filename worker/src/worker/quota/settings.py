from __future__ import annotations

from dataclasses import dataclass

from worker.config import WorkerSettings


@dataclass(frozen=True)
class QuotaLimits:
    turns_per_day: int
    voice_minutes_per_day: float
    timezone: str
    warn_ratio: float


def env_quota_limits(settings: WorkerSettings) -> QuotaLimits:
    return QuotaLimits(
        turns_per_day=settings.quota_turns_per_day,
        voice_minutes_per_day=settings.quota_voice_minutes_per_day,
        timezone=settings.quota_timezone,
        warn_ratio=settings.quota_warn_ratio,
    )


def resolve_quota_limits(
    stored: QuotaLimits | None,
    fallback: QuotaLimits,
) -> QuotaLimits:
    return stored if stored is not None else fallback
