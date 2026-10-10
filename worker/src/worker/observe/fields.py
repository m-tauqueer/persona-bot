from __future__ import annotations

from worker.config import WorkerSettings


def parse_field_list(raw: str) -> list[str]:
    return [item.strip() for item in raw.replace("\n", ",").split(",") if item.strip()]


def turn_log_fields(
    settings: WorkerSettings,
    fields: dict[str, object],
) -> dict[str, object]:
    allowed = set(parse_field_list(settings.log_turn_fields))
    return {
        key: fields[key]
        for key in allowed
        if key in fields and fields[key] is not None
    }
