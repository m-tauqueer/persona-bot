from __future__ import annotations

import threading
from collections import OrderedDict

from worker.config import WorkerSettings
from worker.engram.engram_brain import EngramBrain
from worker.engram.user_id import persona_engine_user_id


class BrainRegistry:
    """Keeps one open Engram client per user so no turn pays a TLS handshake.

    The SDK client wraps a thread-safe HTTP client, so a single instance is
    shared across concurrent turns for the same user. Least-recently-used
    entries are closed when the cache is full.

    ``api_key`` is captured at construction. A member JWT must not be reused
    after refresh: pass the current token and a cached brain built on a
    different token is replaced. Org-key brains omit ``api_key``.
    """

    def __init__(self, settings: WorkerSettings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._brains: OrderedDict[str, EngramBrain] = OrderedDict()

    def get(
        self,
        engram_user_id: str,
        *,
        api_key: str | None = None,
    ) -> EngramBrain:
        key = persona_engine_user_id(engram_user_id)
        stale: EngramBrain | None = None
        with self._lock:
            existing = self._brains.get(key)
            if existing is not None and existing.uses_member_token(api_key):
                self._brains.move_to_end(key)
                return existing
            if existing is not None:
                stale = self._brains.pop(key)
        brain = EngramBrain(self._settings, key, api_key=api_key)
        evicted: EngramBrain | None = None
        extras: list[EngramBrain] = []
        with self._lock:
            racer = self._brains.get(key)
            if racer is not None and racer.uses_member_token(api_key):
                self._brains.move_to_end(key)
                evicted = brain
                brain = racer
            else:
                if racer is not None:
                    extras.append(self._brains.pop(key))
                self._brains[key] = brain
                while len(self._brains) > self._settings.engram_client_cache_size:
                    _, extra = self._brains.popitem(last=False)
                    extras.append(extra)
        for doomed in (stale, evicted, *extras):
            if doomed is not None and doomed is not brain:
                _close(doomed)
        return brain

    def forget(self, engram_user_id: str) -> None:
        key = persona_engine_user_id(engram_user_id)
        with self._lock:
            evicted = self._brains.pop(key, None)
        if evicted is not None:
            _close(evicted)

    def close(self) -> None:
        with self._lock:
            brains = list(self._brains.values())
            self._brains.clear()
        for brain in brains:
            _close(brain)


def _close(brain: EngramBrain) -> None:
    try:
        brain.close()
    except Exception:  # noqa: BLE001 - closing must never break a turn
        pass
