from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from worker.api.http import raise_turn, read_correlation_id
from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings
from worker.notices import publish_notice
from worker.observe.fields import turn_log_fields
from worker.ops.record import record_ops_event, record_turn_error
from worker.turn.errors import TurnError
from worker.turn.openai_completion import (
    chunk_line,
    completion_payload,
    done_line,
    new_completion_id,
)
from worker.turn.openai_messages import last_user_text
from worker.turn.service import TurnPlan, TurnRunner

log = structlog.get_logger(__name__)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: str
    content: Any = None


class ChatCompletionsIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    messages: list[ChatMessage] = Field(min_length=1)
    model: str | None = None
    stream: bool = False


def _header(request: Request, name: str) -> str:
    value = request.headers.get(name)
    if value is None or not value.strip():
        raise HTTPException(
            status_code=400,
            detail={"error": "missing identity header", "header": name},
        )
    return value.strip()


def _uuid_header(request: Request, name: str) -> UUID:
    raw = _header(request, name)
    try:
        return UUID(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid identity header", "header": name},
        ) from exc


def build_chat_completions_router(
    settings: WorkerSettings,
    runner: TurnRunner | None = None,
) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(dependencies=[Depends(guard)])
    runner = runner or TurnRunner(settings)
    path = settings.byo_llm_chat_completions_path

    def _finish(plan: TurnPlan) -> None:
        result = runner.finish(plan)
        if not result.recorded:
            publish_notice(
                settings,
                plan.session_id,
                settings.failure_code_record,
                settings.failure_message_record,
            )
            record_ops_event(
                settings,
                code=settings.failure_code_record,
                message=settings.failure_message_record,
                correlation_id=plan.correlation_id,
            )

    @router.post(path, response_model=None)
    def chat_completions(
        request: Request,
        body: ChatCompletionsIn,
    ) -> dict[str, Any] | StreamingResponse:
        app_user_id = _uuid_header(request, settings.byo_llm_app_user_header)
        persona_id = _uuid_header(request, settings.byo_llm_persona_header)
        session_id = _uuid_header(request, settings.byo_llm_session_header)
        engram_user_id = _header(request, settings.byo_llm_engram_user_header)
        correlation_id = read_correlation_id(request, settings)
        text = last_user_text(
            [message.model_dump() for message in body.messages],
            user_role=settings.byo_llm_user_role,
            text_part_type=settings.byo_llm_text_part_type,
        )
        streaming = bool(body.stream) and settings.reframe_stream_enabled
        # Everything that can choose a status code happens before the first byte.
        try:
            plan = runner.begin(
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                persona_id=persona_id,
                session_id=session_id,
                text=text,
                correlation_id=correlation_id,
            )
        except TurnError as exc:
            record_turn_error(settings, exc, correlation_id)
            raise_turn(exc)

        log.info(
            "voice turn requested",
            stream_requested=bool(body.stream),
            streaming=streaming,
            messages=len(body.messages),
            has_text=bool(text.strip()),
            **turn_log_fields(
                settings,
                {
                    "correlation_id": str(plan.correlation_id),
                    "session_id": str(session_id),
                },
            ),
        )

        completion_id = new_completion_id(settings)
        created = int(time.time())
        model = body.model or settings.openai_model

        if streaming:
            return StreamingResponse(
                _stream(
                    plan,
                    completion_id=completion_id,
                    created=created,
                    model=model,
                ),
                media_type=settings.byo_llm_sse_media_type,
            )

        if plan.speaks:
            try:
                runner.speak(plan)
            except TurnError as exc:
                record_turn_error(settings, exc, correlation_id)
                raise_turn(exc)
        result = runner.finish(plan)
        if not result.recorded:
            publish_notice(
                settings,
                plan.session_id,
                settings.failure_code_record,
                settings.failure_message_record,
            )
            record_ops_event(
                settings,
                code=settings.failure_code_record,
                message=settings.failure_message_record,
                correlation_id=plan.correlation_id,
            )
        return completion_payload(
            settings,
            completion_id=completion_id,
            created=created,
            model=model,
            content=result.reply_text or "",
        )

    def _stream(
        plan: TurnPlan,
        *,
        completion_id: str,
        created: int,
        model: str,
    ) -> Iterator[str]:
        frame = {
            "completion_id": completion_id,
            "created": created,
            "model": model,
        }
        yield chunk_line(
            settings,
            **frame,
            delta={"role": settings.byo_llm_assistant_role},
        )
        if plan.speaks:
            try:
                for piece in runner.stream_speak(plan):
                    yield chunk_line(settings, **frame, delta={"content": piece})
            except Exception as exc:
                # The listener hears only what was actually produced. Nothing
                # is invented to cover the gap.
                log.error(
                    "speaking llm failed mid-stream",
                    session_id=str(plan.session_id),
                    error=str(exc),
                    spoke=plan.spoken is not None,
                )
                publish_notice(
                    settings,
                    plan.session_id,
                    settings.failure_code_speaking_llm,
                    settings.failure_message_speaking_llm,
                )
                record_ops_event(
                    settings,
                    code=settings.failure_code_speaking_llm,
                    message=settings.failure_message_speaking_llm,
                    correlation_id=plan.correlation_id,
                )
        yield chunk_line(
            settings,
            **frame,
            delta={},
            finish_reason=settings.byo_llm_finish_reason,
        )
        yield done_line(settings)
        _finish(plan)

    return router
