from __future__ import annotations


def quota_applies_to_caller(*, owner: bool) -> bool:
    return not owner


def parse_owner_emails(raw: str) -> frozenset[str]:
    return frozenset(
        part.strip().lower() for part in raw.replace(",", " ").split() if part.strip()
    )


def is_owner_email(email: str, raw_owners: str) -> bool:
    return email.strip().lower() in parse_owner_emails(raw_owners)


def quota_limit_active(limit: float) -> bool:
    return limit > 0


def quota_exceeded(used: float, limit: float) -> bool:
    return quota_limit_active(limit) and used >= limit


def quota_should_warn(used: float, limit: float, ratio: float) -> bool:
    return quota_limit_active(limit) and ratio > 0 and used >= limit * ratio


def first_quota_hit(
    *,
    turns_used: float,
    turns_limit: float,
    turns_kind: str,
    minutes_used: float,
    minutes_limit: float,
    minutes_kind: str,
) -> str | None:
    if quota_exceeded(turns_used, turns_limit):
        return turns_kind
    if quota_exceeded(minutes_used, minutes_limit):
        return minutes_kind
    return None
