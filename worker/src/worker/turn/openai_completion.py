from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any
from uuid import uuid4

from worker.config import WorkerSettings


def new_completion_id(settings: WorkerSettings) -> str:
    return f"{settings.byo_llm_completion_id_prefix}{uuid4().hex}"


def completion_payload(
    settings: WorkerSettings,
    *,
    completion_id: str,
    created: int,
    model: str,
    content: str,
) -> dict[str, Any]:
    return {
        "id": completion_id,
        "object": settings.byo_llm_completion_object,
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": settings.byo_llm_assistant_role,
                    "content": content,
                },
                "finish_reason": settings.byo_llm_finish_reason,
            }
        ],
    }


def _chunk(
    settings: WorkerSettings,
    *,
    completion_id: str,
    created: int,
    model: str,
    delta: dict[str, Any],
    finish_reason: str | None,
) -> dict[str, Any]:
    return {
        "id": completion_id,
        "object": settings.byo_llm_chunk_object,
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }


def chunk_line(
    settings: WorkerSettings,
    *,
    completion_id: str,
    created: int,
    model: str,
    delta: dict[str, Any],
    finish_reason: str | None = None,
) -> str:
    payload = _chunk(
        settings,
        completion_id=completion_id,
        created=created,
        model=model,
        delta=delta,
        finish_reason=finish_reason,
    )
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def done_line(settings: WorkerSettings) -> str:
    return f"data: {settings.byo_llm_sse_done}\n\n"


def iter_sse_chunks(
    settings: WorkerSettings,
    *,
    completion_id: str,
    created: int,
    model: str,
    content: str,
) -> Iterator[str]:
    """Whole-utterance SSE. Used when the reply is already complete."""
    yield chunk_line(
        settings,
        completion_id=completion_id,
        created=created,
        model=model,
        delta={"role": settings.byo_llm_assistant_role},
    )
    if content:
        yield chunk_line(
            settings,
            completion_id=completion_id,
            created=created,
            model=model,
            delta={"content": content},
        )
    yield chunk_line(
        settings,
        completion_id=completion_id,
        created=created,
        model=model,
        delta={},
        finish_reason=settings.byo_llm_finish_reason,
    )
    yield done_line(settings)
