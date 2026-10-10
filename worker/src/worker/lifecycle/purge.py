from __future__ import annotations

from typing import Any, Protocol

import structlog

from worker.config import WorkerSettings
from worker.engram.errors import BrainError
from worker.engram.factory import create_org_engram
from worker.engram.user_id import persona_engine_user_ids
from worker.lifecycle.gids import (
    memory_gids,
    memory_rows,
    memory_text,
    next_cursor,
    row_gid,
)

log = structlog.get_logger(__name__)


class PersonaForgetSurface(Protocol):
    def user_memories(self, persona_id: str, user_id: str, **params: Any) -> Any: ...

    def forget_user_memory(
        self,
        persona_id: str,
        user_id: str,
        gid: int | str,
    ) -> Any: ...

    def unsubscribe(self, persona_id: str, user_id: str) -> Any: ...


def _engram_ready(settings: WorkerSettings) -> bool:
    return bool(
        settings.engram_api_key
        and settings.engram_org_id
        and settings.engram_base_url is not None
    )


def _open_forget_surface(
    settings: WorkerSettings,
    personas: PersonaForgetSurface | None,
) -> tuple[PersonaForgetSurface | None, Any]:
    if personas is not None:
        return personas, None
    if not _engram_ready(settings):
        return None, None
    client = create_org_engram(settings)
    return client.personas, client


def list_private_pool(
    settings: WorkerSettings,
    *,
    engram_user_id: str,
    engram_persona_id: str,
    personas: PersonaForgetSurface | None = None,
) -> dict[str, object]:
    surface, client = _open_forget_surface(settings, personas)
    if surface is None:
        return {
            "engram": "skipped",
            "count": 0,
            "memories": [],
        }
    memories: list[dict[str, object]] = []
    seen: set[str] = set()
    try:
        for engine_user_id in persona_engine_user_ids(engram_user_id):
            cursor: str | None = None
            while True:
                params: dict[str, object] = {
                    "limit": settings.lifecycle_memory_page_size,
                }
                if cursor:
                    params["cursor"] = cursor
                page = surface.user_memories(
                    engram_persona_id,
                    engine_user_id,
                    **params,
                )
                for row in memory_rows(page):
                    gid = row_gid(row)
                    key = str(gid) if gid is not None else ""
                    if key and key in seen:
                        continue
                    if key:
                        seen.add(key)
                    memories.append(
                        {
                            "gid": gid,
                            "text": memory_text(row),
                        }
                    )
                cursor = next_cursor(page)
                if not cursor:
                    break
        return {
            "engram": "ok",
            "count": len(memories),
            "memories": memories,
        }
    finally:
        if client is not None:
            client.close()


def purge_private_pool(
    settings: WorkerSettings,
    *,
    engram_user_id: str,
    engram_persona_id: str,
    personas: PersonaForgetSurface | None = None,
    unsubscribe: bool = True,
) -> dict[str, object]:
    if personas is None and not _engram_ready(settings):
        return {
            "engram": "skipped",
            "forgotten": 0,
            "unsubscribed": False,
        }
    surface, client = _open_forget_surface(settings, personas)
    if surface is None:
        return {
            "engram": "skipped",
            "forgotten": 0,
            "unsubscribed": False,
        }
    forgotten = 0
    failed = 0
    engine_user_ids = persona_engine_user_ids(engram_user_id)
    try:
        for engine_user_id in engine_user_ids:
            cursor: str | None = None
            while True:
                params: dict[str, object] = {
                    "limit": settings.lifecycle_memory_page_size,
                }
                if cursor:
                    params["cursor"] = cursor
                page = surface.user_memories(
                    engram_persona_id,
                    engine_user_id,
                    **params,
                )
                for gid in memory_gids(page):
                    try:
                        surface.forget_user_memory(
                            engram_persona_id,
                            engine_user_id,
                            gid,
                        )
                        forgotten += 1
                    except BrainError:
                        failed += 1
                        log.warning(
                            "engram forget failed",
                            gid=str(gid),
                            user_id=engine_user_id,
                        )
                    except Exception:
                        failed += 1
                        log.warning(
                            "engram forget failed",
                            gid=str(gid),
                            user_id=engine_user_id,
                        )
                cursor = next_cursor(page)
                if not cursor:
                    break
        unsubscribed = False
        if unsubscribe:
            try:
                for engine_user_id in engine_user_ids:
                    surface.unsubscribe(engram_persona_id, engine_user_id)
                unsubscribed = True
            except Exception:
                log.warning(
                    "engram unsubscribe failed",
                    user_id=engram_user_id,
                )
        status = "ok" if failed == 0 else "partial"
        return {
            "engram": status,
            "forgotten": forgotten,
            "unsubscribed": unsubscribed,
        }
    finally:
        if client is not None:
            client.close()
