from datetime import UTC, datetime

from worker.config import WorkerSettings
from worker.quota.decision import (
    first_quota_hit,
    is_owner_email,
    quota_applies_to_caller,
    quota_exceeded,
    quota_limit_active,
    quota_should_warn,
)
from worker.quota.settings import QuotaLimits, env_quota_limits, resolve_quota_limits
from worker.quota.store import QuotaUsage, refuse_quota


def test_owner_is_not_capped() -> None:
    assert quota_applies_to_caller(owner=True) is False
    assert quota_applies_to_caller(owner=False) is True
    assert is_owner_email("Owner@Example.com", "owner@example.com, other@x.com")
    assert not is_owner_email("member@example.com", "owner@example.com")


def test_zero_limit_is_off() -> None:
    assert quota_limit_active(0) is False
    assert quota_exceeded(99, 0) is False
    assert quota_should_warn(99, 0, 0.8) is False


def test_exceeded_at_the_cap() -> None:
    assert quota_exceeded(10, 10) is True
    assert quota_exceeded(9, 10) is False


def test_warns_at_ratio() -> None:
    assert quota_should_warn(8, 10, 0.8) is True
    assert quota_should_warn(7, 10, 0.8) is False


def test_turns_hit_before_minutes() -> None:
    assert (
        first_quota_hit(
            turns_used=10,
            turns_limit=10,
            turns_kind="turns",
            minutes_used=99,
            minutes_limit=10,
            minutes_kind="minutes",
        )
        == "turns"
    )
    assert (
        first_quota_hit(
            turns_used=1,
            turns_limit=10,
            turns_kind="turns",
            minutes_used=10,
            minutes_limit=10,
            minutes_kind="minutes",
        )
        == "minutes"
    )
    assert (
        first_quota_hit(
            turns_used=1,
            turns_limit=10,
            turns_kind="turns",
            minutes_used=1,
            minutes_limit=10,
            minutes_kind="minutes",
        )
        is None
    )


def test_refuse_quota_uses_configured_copy(settings: WorkerSettings) -> None:
    settings = settings.model_copy(
        update={"quota_turns_per_day": 200, "quota_voice_minutes_per_day": 60},
    )
    limits = env_quota_limits(settings)
    usage = QuotaUsage(
        turns_used=limits.turns_per_day,
        minutes_used=0,
        reset_at=datetime.now(UTC),
    )
    refused = refuse_quota(settings, usage, limits)
    assert refused is not None
    assert refused["code"] == settings.quota_code_turns
    assert refused["error"] == settings.quota_error_turns


def test_stored_limits_override_env(settings: WorkerSettings) -> None:
    fallback = env_quota_limits(settings)
    stored = QuotaLimits(
        turns_per_day=1,
        voice_minutes_per_day=0,
        timezone="UTC",
        warn_ratio=0.5,
    )
    assert resolve_quota_limits(None, fallback) == fallback
    resolved = resolve_quota_limits(stored, fallback)
    assert resolved.turns_per_day == 1
    assert resolved.voice_minutes_per_day == 0
