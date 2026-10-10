from __future__ import annotations

import psycopg
from openai import OpenAI

from worker.config import WorkerSettings
from worker.decisions.defaults import DEFAULT_DECISIONS_BASE_URL


def create_postgres(settings: WorkerSettings) -> psycopg.Connection:
    return psycopg.connect(settings.database_url)


def openai_base_url(settings: WorkerSettings) -> str | None:
    raw = settings.openai_base_url or settings.openai_api_base_url
    if not raw:
        return None
    trimmed = raw.rstrip("/")
    if trimmed.endswith("/v1"):
        return trimmed
    return f"{trimmed}/v1"


def create_openai(settings: WorkerSettings) -> OpenAI:
    if not settings.openai_api_key:
        raise RuntimeError("OpenAI is not configured (OPENAI_API_KEY)")
    base_url = openai_base_url(settings)
    if base_url:
        return OpenAI(api_key=settings.openai_api_key, base_url=base_url)
    return OpenAI(api_key=settings.openai_api_key)


def create_decisions(settings: WorkerSettings) -> OpenAI:
    """Independent provider connection; never inherit the speaking base URL."""
    key = settings.decisions_api_key or settings.openai_api_key
    if not key:
        raise RuntimeError("Decisions is not configured")
    options = {"api_key": key, "max_retries": settings.decisions_max_retries}
    base = str(settings.decisions_base_url or DEFAULT_DECISIONS_BASE_URL).rstrip("/")
    options["base_url"] = base if base.endswith("/v1") else f"{base}/v1"
    return OpenAI(**options)
