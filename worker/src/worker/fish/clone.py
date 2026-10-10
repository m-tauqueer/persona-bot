from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx
import structlog

from worker.config import WorkerSettings
from worker.fish.errors import FishCloneError

log = structlog.get_logger("worker.fish.clone")


@dataclass(frozen=True)
class ClonedVoice:
    voice_id: str
    state: str


class FishCloneClient(Protocol):
    def create(
        self,
        *,
        title: str,
        audio: bytes,
        filename: str,
        content_type: str,
    ) -> ClonedVoice: ...


def _voice_id(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw = payload.get("_id", payload.get("id"))
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _voice_state(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    raw = payload.get("state")
    if isinstance(raw, str):
        return raw.strip()
    return ""


class HttpFishClone:
    def __init__(self, settings: WorkerSettings) -> None:
        self._settings = settings

    def create(
        self,
        *,
        title: str,
        audio: bytes,
        filename: str,
        content_type: str,
    ) -> ClonedVoice:
        key = self._settings.fish_api_key
        if not key:
            raise FishCloneError(
                self._settings.admin_error_fish_key_missing,
                status=503,
                reason="fish_key_missing",
            )
        url = f"{self._settings.fish_api_base_url.rstrip('/')}/model"
        files = {
            "voices": (
                filename or "clip",
                audio,
                content_type or "application/octet-stream",
            ),
        }
        data = {
            "type": self._settings.fish_clone_type,
            "title": title,
            "visibility": self._settings.fish_clone_visibility,
            "train_mode": self._settings.fish_clone_train_mode,
            "enhance_audio_quality": (
                "true" if self._settings.fish_clone_enhance else "false"
            ),
        }
        try:
            response = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                data=data,
                files=files,
                timeout=self._settings.fish_clone_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise FishCloneError(
                self._settings.admin_error_fish_clone_failed,
                status=502,
                reason="fish_clone_failed",
            ) from exc
        if response.status_code == 401:
            raise FishCloneError(
                self._settings.admin_error_fish_unauthorized,
                status=401,
                reason="fish_unauthorized",
            )
        if response.status_code == 402:
            raise FishCloneError(
                self._settings.admin_error_fish_payment,
                status=402,
                reason="fish_payment",
            )
        if response.status_code >= 400:
            raise FishCloneError(
                self._settings.admin_error_fish_clone_failed,
                status=502,
                reason="fish_clone_failed",
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise FishCloneError(
                self._settings.admin_error_fish_clone_failed,
                status=502,
                reason="fish_clone_failed",
            ) from exc
        voice_id = _voice_id(payload)
        if not voice_id:
            raise FishCloneError(
                self._settings.admin_error_fish_clone_failed,
                status=502,
                reason="fish_clone_failed",
            )
        state = _voice_state(payload)
        log.info("fish_clone_created", voice_id=voice_id, state=state)
        return ClonedVoice(voice_id=voice_id, state=state)
