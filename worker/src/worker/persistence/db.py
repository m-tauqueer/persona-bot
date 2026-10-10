from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from worker.config import WorkerSettings

_pool: ConnectionPool | None = None
_pool_url: str | None = None
_pool_lock = threading.Lock()


def connect(settings: WorkerSettings) -> psycopg.Connection:
    """A standalone connection. Probes and one-shot scripts use this."""
    return psycopg.connect(settings.database_url, row_factory=dict_row)


def _build_pool(settings: WorkerSettings) -> ConnectionPool:
    return ConnectionPool(
        settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        timeout=settings.db_pool_timeout_seconds,
        max_idle=settings.db_pool_max_idle_seconds,
        kwargs={"row_factory": dict_row},
        open=True,
    )


def pool(settings: WorkerSettings) -> ConnectionPool:
    """Process-wide pool. Reused across turns so no turn pays connection setup."""
    global _pool, _pool_url
    with _pool_lock:
        if _pool is None or _pool_url != settings.database_url:
            if _pool is not None:
                _pool.close()
            _pool = _build_pool(settings)
            _pool_url = settings.database_url
        return _pool


@contextmanager
def borrow(settings: WorkerSettings) -> Iterator[psycopg.Connection]:
    """Check a connection out of the pool for one short unit of work."""
    with pool(settings).connection() as conn:
        yield conn


def close_pool() -> None:
    global _pool, _pool_url
    with _pool_lock:
        if _pool is not None:
            _pool.close()
        _pool = None
        _pool_url = None
