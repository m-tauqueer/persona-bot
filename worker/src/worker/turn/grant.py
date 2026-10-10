from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import structlog

from worker.config import WorkerSettings
from worker.engram.errors import (
    BrainError,
    ConflictError,
    ForbiddenError,
    ValidationError,
)
from worker.engram.user_id import persona_engine_user_id

log = structlog.get_logger("worker.turn.grant")


class PersonaGrantSurface(Protocol):
    def subscribe(self, persona_id: str, user_id: str) -> Any: ...


@dataclass(frozen=True)
class GrantOutcome:
    subscribed: bool
    mirror: bool
    reason: str | None
    status: int | None = None


def should_attempt_grant(*, mirrored: bool, already_tried: bool) -> bool:
    if mirrored or already_tried:
        return False
    return True


def grant_persona_access(
    brain: PersonaGrantSurface,
    settings: WorkerSettings,
    *,
    engram_persona_id: str,
    engram_user_id: str,
) -> GrantOutcome:
    try:
        brain.subscribe(engram_persona_id, persona_engine_user_id(engram_user_id))
        return GrantOutcome(subscribed=True, mirror=True, reason=None)
    except ConflictError:
        return GrantOutcome(subscribed=True, mirror=True, reason="already")
    except ForbiddenError as exc:
        log.warning(settings.log_subscribe_forbidden)
        return GrantOutcome(
            subscribed=False,
            mirror=False,
            reason="forbidden",
            status=exc.status,
        )
    except ValidationError as exc:
        log.warning(settings.log_subscribe_failed, status=exc.status)
        return GrantOutcome(
            subscribed=False,
            mirror=False,
            reason="validation",
            status=exc.status,
        )
    except BrainError as exc:
        log.warning(settings.log_subscribe_failed, status=exc.status)
        return GrantOutcome(
            subscribed=False,
            mirror=False,
            reason="brain_error",
            status=exc.status,
        )
    except Exception:
        log.exception(settings.log_subscribe_failed)
        return GrantOutcome(subscribed=False, mirror=False, reason="error")
