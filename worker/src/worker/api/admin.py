from __future__ import annotations

from io import BytesIO
from typing import Any, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from worker.admin.errors import AdminError
from worker.admin.service import PersonaAdmin
from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings


class PersonaWriteIn(BaseModel):
    persona_id: UUID | None = None
    engram_persona_id: str | None = None
    handle: str | None = None
    display_name: str | None = None
    description: str | None = None
    voice_config: dict[str, Any] | None = None
    tts_voice: str | None = None
    fish_voice: str | None = None
    voice_provider: str | None = None
    create_remote: bool = False


class TeachIn(BaseModel):
    text: str = Field(min_length=1)
    persona_id: UUID | None = None


class AnswerIn(BaseModel):
    question_key: str = Field(min_length=1)
    text: str = Field(min_length=1)
    persona_id: UUID | None = None


class SubscribeIn(BaseModel):
    user: str = Field(min_length=1)
    persona_id: UUID | None = None


class PublishIn(BaseModel):
    published: bool
    persona_id: UUID | None = None


class DestroyIn(BaseModel):
    confirmation: str = Field(min_length=1)
    persona_id: UUID | None = None


def _raise_admin(exc: AdminError) -> NoReturn:
    raise HTTPException(
        status_code=exc.status,
        detail={"error": str(exc), "reason": exc.reason},
    ) from exc


def build_admin_router(settings: WorkerSettings) -> APIRouter:
    guard = require_internal_secret(settings)
    router = APIRouter(prefix="/internal/admin", dependencies=[Depends(guard)])
    admin = PersonaAdmin(settings)

    @router.get("/persona")
    def show(persona_id: UUID | None = Query(default=None)) -> dict[str, Any]:
        try:
            return admin.show(persona_id)
        except AdminError as exc:
            _raise_admin(exc)

    @router.put("/persona")
    def write_persona(body: PersonaWriteIn) -> dict[str, Any]:
        try:
            if body.create_remote:
                if not body.display_name or not body.handle:
                    raise AdminError(
                        "create_remote requires display_name and handle",
                        reason="missing_fields",
                    )
                return admin.create_remote(
                    name=body.display_name,
                    handle=body.handle,
                    description=body.description or "",
                    voice_config=body.voice_config or {},
                    tts_voice=body.tts_voice,
                    fish_voice=body.fish_voice,
                    voice_provider=body.voice_provider,
                )
            if body.engram_persona_id:
                return admin.register(
                    engram_persona_id=body.engram_persona_id,
                    handle=body.handle,
                    display_name=body.display_name,
                    description=body.description,
                    voice_config=body.voice_config or {},
                    tts_voice=body.tts_voice,
                    fish_voice=body.fish_voice,
                    voice_provider=body.voice_provider,
                )
            return admin.update_local(
                persona_id=body.persona_id,
                handle=body.handle,
                display_name=body.display_name,
                description=body.description,
                voice_config=body.voice_config,
                tts_voice=body.tts_voice,
                fish_voice=body.fish_voice,
                voice_provider=body.voice_provider,
            )
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/persona/publish")
    def publish_persona(body: PublishIn) -> dict[str, Any]:
        try:
            return admin.publish(
                published=body.published,
                persona_id=body.persona_id,
            )
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/persona/destroy")
    def destroy_persona(body: DestroyIn) -> dict[str, Any]:
        try:
            return admin.destroy(
                confirmation=body.confirmation,
                persona_id=body.persona_id,
            )
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/teach")
    def teach(body: TeachIn) -> dict[str, Any]:
        try:
            return admin.teach(body.text, persona_id=body.persona_id)
        except AdminError as exc:
            _raise_admin(exc)

    @router.get("/questions")
    def questions(persona_id: UUID | None = Query(default=None)) -> dict[str, Any]:
        try:
            return admin.questions(persona_id=persona_id)
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/answer")
    def answer(body: AnswerIn) -> dict[str, Any]:
        try:
            return admin.answer(
                body.question_key,
                body.text,
                persona_id=body.persona_id,
            )
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/ingest")
    def ingest(
        file: UploadFile = File(...),
        persona_id: UUID | None = Query(default=None),
    ) -> dict[str, Any]:
        data = file.file.read()
        if len(data) > settings.admin_ingest_max_bytes:
            raise HTTPException(status_code=413, detail={"error": "file too large"})
        metadata: dict[str, Any] = {}
        if file.filename:
            metadata["filename"] = file.filename
        if file.content_type:
            metadata["content_type"] = file.content_type
        source = BytesIO(data)
        if file.filename:
            source.name = file.filename
        try:
            return admin.ingest_document(source, metadata, persona_id=persona_id)
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/persona/clone")
    def clone_voice(
        file: UploadFile = File(...),
        persona_id: UUID | None = Query(default=None),
    ) -> dict[str, Any]:
        data = file.file.read()
        if len(data) > settings.admin_fish_clone_max_bytes:
            raise HTTPException(status_code=413, detail={"error": "file too large"})
        try:
            return admin.clone_voice(
                audio=data,
                filename=file.filename or "",
                content_type=file.content_type or "",
                persona_id=persona_id,
            )
        except AdminError as exc:
            _raise_admin(exc)

    @router.post("/subscribe")
    def subscribe(body: SubscribeIn) -> dict[str, Any]:
        try:
            return admin.subscribe(
                body.user,
                persona_id=body.persona_id,
            )
        except AdminError as exc:
            _raise_admin(exc)

    return router
