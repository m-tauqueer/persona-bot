from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager, contextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from worker.admin.confirm import confirmation_matches
from worker.admin.errors import AdminError
from worker.admin.store import (
    connect,
    delete_persona_cascade,
    find_user,
    get_persona,
    list_personas,
    list_subscriptions,
    pick_single_persona,
    set_engram_user_id,
    set_persona_published,
    upsert_persona,
    upsert_subscription,
)
from worker.admin.voice import VoiceProviderError, as_voice_config, merge_persona_voices
from worker.config import WorkerSettings
from worker.engram.engram_brain import EngramBrain
from worker.engram.errors import (
    BrainError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from worker.engram.interface import IngestOutcome, PersonaBrain, PersonaRecord
from worker.engram.member_secret import (
    MemberSecretError,
    ciphertext_for_password,
    decode_member_secret_key,
)
from worker.engram.org_member import (
    OrgMember,
    OrgRoster,
    ensure_org_member,
    open_org_roster,
    skip_org_join,
)
from worker.engram.user_id import persona_engine_user_id
from worker.fish.accept import clip_allowed, parse_allowlist
from worker.fish.clone import ClonedVoice, FishCloneClient, HttpFishClone
from worker.fish.errors import FishCloneError
from worker.lifecycle.purge import list_private_pool, purge_private_pool
from worker.schema import SUBSCRIPTION_ACTIVE


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, PersonaRecord):
        return asdict(value)
    if isinstance(value, IngestOutcome):
        return asdict(value)
    return str(value)


def _row(value: dict[str, Any]) -> dict[str, Any]:
    return _jsonable(value)


def _brain_error(exc: BrainError) -> AdminError:
    status = exc.status if exc.status is not None else 502
    return AdminError(str(exc), status=status, reason="brain_error")


def _require_handle(handle: str | None, fallback: str | None) -> str:
    resolved = handle or fallback
    if not resolved:
        raise AdminError("handle is required", reason="missing_handle")
    return resolved


def _pin(persona_id: str | UUID | None) -> str | None:
    if persona_id is None:
        return None
    return str(persona_id)


class PersonaAdmin:
    def __init__(
        self,
        settings: WorkerSettings,
        brain_factory: Callable[[WorkerSettings, str], PersonaBrain] | None = None,
        roster_factory: Callable[[WorkerSettings], OrgRoster] | None = None,
        clone_factory: Callable[[WorkerSettings], FishCloneClient] | None = None,
    ) -> None:
        self._settings = settings
        self._brain_factory = brain_factory or (
            lambda loaded, user_id: EngramBrain(loaded, user_id)
        )
        self._roster_factory = roster_factory
        self._clone_factory = clone_factory or (lambda loaded: HttpFishClone(loaded))

    def _brain(self) -> AbstractContextManager[PersonaBrain]:
        @contextmanager
        def _open() -> Any:
            brain = self._brain_factory(self._settings, "")
            try:
                yield brain
            finally:
                brain.close()

        return _open()

    def _with_voices(
        self,
        voice_config: dict[str, Any] | None,
        tts_voice: str | None,
        fish_voice: str | None,
        provider: str | None = None,
    ) -> dict[str, Any]:
        try:
            return merge_persona_voices(
                as_voice_config(voice_config),
                tts_voice=tts_voice,
                tts_key=self._settings.persona_voice_tts_key,
                fish_voice=fish_voice,
                fish_key=self._settings.persona_voice_fish_key,
                provider=provider,
                provider_key=self._settings.persona_voice_provider_key,
                allowed_providers=frozenset(
                    {
                        self._settings.persona_voice_provider_aura,
                        self._settings.persona_voice_provider_fish,
                    }
                ),
            )
        except VoiceProviderError as exc:
            raise AdminError(
                self._settings.admin_error_voice_provider,
                reason="voice_provider",
            ) from exc

    def _require_active(self, persona_id: str | UUID | None = None) -> dict[str, Any]:
        pin = _pin(persona_id)
        with connect(self._settings) as conn:
            if pin is not None:
                row = get_persona(conn, pin)
            else:
                row = pick_single_persona(
                    list_personas(conn),
                    error=self._settings.admin_error_persona_pin_required,
                )
        if row is None:
            raise AdminError(
                self._settings.persona_error_not_found,
                status=404,
                reason="persona_missing",
            )
        return row

    def seed_persona_id(self) -> str | None:
        """`ENGRAM_PERSONA_ID` seeds an empty catalog and nothing else.

        With rows already recorded it must not stand in for a pin: `register`
        upserts on `engram_persona_id`, so an implicit id would quietly rewrite
        an existing persona's handle, name and voice.
        """
        seed = self._settings.engram_persona_id
        if not seed:
            return None
        with connect(self._settings) as conn:
            if list_personas(conn):
                return None
        return seed

    def show(self, persona_id: str | UUID | None = None) -> dict[str, Any]:
        pin = _pin(persona_id)
        with connect(self._settings) as conn:
            rows = list_personas(conn)
            if pin is not None:
                local = get_persona(conn, pin)
                if local is None:
                    raise AdminError(
                        self._settings.persona_error_not_found,
                        status=404,
                        reason="persona_missing",
                    )
            elif len(rows) == 1:
                local = rows[0]
            else:
                local = None
            subscriptions: list[dict[str, Any]] = []
            if local is not None:
                subscriptions = list_subscriptions(conn, str(local["id"]))
        remote = None
        if local is not None:
            try:
                with self._brain() as brain:
                    remote = brain.get_persona(local["engram_persona_id"])
            except BrainError as exc:
                raise _brain_error(exc) from exc
        return {
            "persona": _row(local) if local else None,
            "personas": [_row(row) for row in rows],
            "engram": _jsonable(remote) if remote else None,
            "subscriptions": _jsonable(subscriptions),
        }

    def register(
        self,
        *,
        engram_persona_id: str,
        handle: str | None,
        display_name: str | None,
        description: str | None,
        voice_config: dict[str, Any],
        tts_voice: str | None = None,
        fish_voice: str | None = None,
        voice_provider: str | None = None,
    ) -> dict[str, Any]:
        try:
            with self._brain() as brain:
                remote = brain.get_persona(engram_persona_id)
        except BrainError as exc:
            raise _brain_error(exc) from exc
        resolved_handle = _require_handle(handle, remote.handle)
        resolved_name = display_name or remote.name
        resolved_description = (
            description if description is not None else remote.description
        )
        with connect(self._settings) as conn:
            local = upsert_persona(
                conn,
                engram_persona_id=remote.id,
                handle=resolved_handle,
                display_name=resolved_name,
                description=resolved_description,
                voice_config=self._with_voices(
                    voice_config, tts_voice, fish_voice, voice_provider
                ),
            )
        return {"persona": _row(local), "engram": _jsonable(remote)}

    def create_remote(
        self,
        *,
        name: str,
        handle: str,
        description: str,
        voice_config: dict[str, Any],
        tts_voice: str | None = None,
        fish_voice: str | None = None,
        voice_provider: str | None = None,
    ) -> dict[str, Any]:
        try:
            with self._brain() as brain:
                remote = brain.create_persona(name, handle, description)
        except ForbiddenError as exc:
            raise AdminError(
                self._settings.admin_error_create_forbidden,
                status=403,
                reason="create_forbidden",
            ) from exc
        except BrainError as exc:
            raise _brain_error(exc) from exc
        with connect(self._settings) as conn:
            local = upsert_persona(
                conn,
                engram_persona_id=remote.id,
                handle=handle,
                display_name=name,
                description=description,
                voice_config=self._with_voices(
                    voice_config, tts_voice, fish_voice, voice_provider
                ),
            )
        return {"persona": _row(local), "engram": _jsonable(remote)}

    def update_local(
        self,
        *,
        persona_id: str | UUID | None = None,
        handle: str | None,
        display_name: str | None,
        description: str | None,
        voice_config: dict[str, Any] | None,
        tts_voice: str | None = None,
        fish_voice: str | None = None,
        voice_provider: str | None = None,
    ) -> dict[str, Any]:
        current = self._require_active(persona_id)
        merged_voice = (
            as_voice_config(current["voice_config"])
            if voice_config is None
            else as_voice_config(voice_config)
        )
        with connect(self._settings) as conn:
            local = upsert_persona(
                conn,
                engram_persona_id=current["engram_persona_id"],
                handle=handle or current["handle"],
                display_name=display_name or current["display_name"],
                description=(
                    current["description"] if description is None else description
                ),
                voice_config=self._with_voices(
                    merged_voice, tts_voice, fish_voice, voice_provider
                ),
            )
        return {"persona": _row(local)}

    def clone_voice(
        self,
        *,
        audio: bytes,
        filename: str,
        content_type: str,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        if not audio:
            raise AdminError(
                self._settings.admin_error_fish_clip_empty,
                reason="fish_clip_empty",
            )
        if len(audio) > self._settings.admin_fish_clone_max_bytes:
            raise AdminError("file too large", status=413, reason="fish_clip_too_large")
        if not clip_allowed(
            filename=filename,
            content_type=content_type,
            content_types=parse_allowlist(self._settings.fish_clone_content_types),
            suffixes=parse_allowlist(self._settings.fish_clone_suffixes),
        ):
            raise AdminError(
                self._settings.admin_error_fish_clip_type,
                reason="fish_clip_type",
            )
        current = self._require_active(persona_id)
        try:
            cloned: ClonedVoice = self._clone_factory(self._settings).create(
                title=str(current["display_name"]),
                audio=audio,
                filename=filename,
                content_type=content_type,
            )
        except FishCloneError as exc:
            raise AdminError(str(exc), status=exc.status, reason=exc.reason) from exc
        ready = self._settings.fish_clone_ready_state
        if cloned.state and cloned.state != ready:
            raise AdminError(
                self._settings.admin_error_fish_untrained,
                status=409,
                reason="fish_untrained",
            )
        return self.update_local(
            persona_id=current["id"],
            handle=None,
            display_name=None,
            description=None,
            voice_config=None,
            fish_voice=cloned.voice_id,
        )

    def publish(
        self,
        *,
        published: bool,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        current = self._require_active(persona_id)
        with connect(self._settings) as conn:
            local = set_persona_published(conn, str(current["id"]), published)
        if local is None:
            raise AdminError(
                self._settings.persona_error_not_found,
                status=404,
                reason="persona_missing",
            )
        return {"persona": _row(local)}

    def destroy(
        self,
        *,
        confirmation: str,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        """Wipe a persona: Engram pools first, then our record of it.

        Engram `delete` removes the shared pool **and** every member's private
        pool for this persona, so there is nothing to unsubscribe afterwards.
        Our rows go last: while they exist we can still name what to delete.
        """
        persona = self._require_active(persona_id)
        if not confirmation_matches(confirmation, str(persona["handle"])):
            raise AdminError(
                self._settings.admin_error_destroy_confirmation,
                status=400,
                reason="confirmation_mismatch",
            )
        engram = "deleted"
        try:
            with self._brain() as brain:
                brain.delete_persona(str(persona["engram_persona_id"]))
        except NotFoundError:
            # Already gone on their side; our row is the only thing left.
            engram = "missing"
        except BrainError as exc:
            raise _brain_error(exc) from exc
        with connect(self._settings) as conn:
            removed = delete_persona_cascade(conn, str(persona["id"]))
        return {
            "ok": True,
            "persona": _row(persona),
            "engram": engram,
            "removed": removed,
        }

    def _named_member(self, identifier: str) -> dict[str, Any]:
        with connect(self._settings) as conn:
            user = find_user(conn, identifier)
        if user is None:
            raise AdminError(
                self._settings.admin_error_user_missing,
                status=404,
                reason="user_missing",
            )
        stored = user.get("engram_user_id")
        if stored is None:
            raise AdminError(
                self._settings.admin_error_engram_user_missing,
                status=409,
                reason="engram_user_missing",
            )
        engine_id = str(stored).strip()
        if not engine_id:
            raise AdminError(
                self._settings.admin_error_engram_user_missing,
                status=409,
                reason="engram_user_missing",
            )
        return {**user, "engram_user_id": engine_id}

    def list_private(
        self,
        identifier: str,
        *,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        persona = self._require_active(persona_id)
        user = self._named_member(identifier)
        listed = list_private_pool(
            self._settings,
            engram_user_id=str(user["engram_user_id"]),
            engram_persona_id=str(persona["engram_persona_id"]),
        )
        return {
            "ok": True,
            "persona": _row(persona),
            "user": _row(user),
            "engram": listed["engram"],
            "count": listed["count"],
            "memories": listed["memories"],
        }

    def forget_private(
        self,
        identifier: str,
        *,
        confirmation: str,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        """Forget one member's private pool for one persona.

        Uses the same `user_memories` / `forget_user_memory` loop as
        delete-my-data. Does not `personas.delete`, does not unsubscribe,
        and never walks every member.
        """
        persona = self._require_active(persona_id)
        if not confirmation_matches(confirmation, str(persona["handle"])):
            raise AdminError(
                self._settings.admin_error_forget_private_confirmation,
                status=400,
                reason="confirmation_mismatch",
            )
        user = self._named_member(identifier)
        result = purge_private_pool(
            self._settings,
            engram_user_id=str(user["engram_user_id"]),
            engram_persona_id=str(persona["engram_persona_id"]),
            unsubscribe=False,
        )
        return {
            "ok": True,
            "persona": _row(persona),
            "user": _row(user),
            "engram": result["engram"],
            "forgotten": result["forgotten"],
            "unsubscribed": result["unsubscribed"],
        }

    def teach(
        self,
        text: str,
        *,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        persona = self._require_active(persona_id)
        try:
            with self._brain() as brain:
                result = brain.teach(persona["engram_persona_id"], text)
        except BrainError as exc:
            raise _brain_error(exc) from exc
        return {"ok": True, "result": _jsonable(result)}

    def questions(
        self,
        *,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        persona = self._require_active(persona_id)
        try:
            with self._brain() as brain:
                result = brain.questions(persona["engram_persona_id"])
        except BrainError as exc:
            raise _brain_error(exc) from exc
        payload = result if isinstance(result, dict) else {"value": result}
        questions = payload.get("questions")
        return {
            "questions": _jsonable(questions if isinstance(questions, list) else []),
            "coverage": _jsonable(payload.get("coverage")),
            "raw": _jsonable(payload),
        }

    def answer(
        self,
        question_key: str,
        text: str,
        *,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        persona = self._require_active(persona_id)
        try:
            with self._brain() as brain:
                result = brain.answer(
                    persona["engram_persona_id"],
                    question_key,
                    text,
                )
        except BrainError as exc:
            raise _brain_error(exc) from exc
        return {"ok": True, "result": _jsonable(result)}

    def ingest_document(
        self,
        source: Any,
        metadata: dict[str, Any] | None = None,
        *,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        persona = self._require_active(persona_id)
        try:
            with self._brain() as brain:
                result = brain.ingest_shared_document(
                    persona["engram_persona_id"],
                    source,
                    metadata,
                )
        except BrainError as exc:
            raise _brain_error(exc) from exc
        return {"ok": True, "ingest": _jsonable(result)}

    def subscribe(
        self,
        identifier: str,
        *,
        persona_id: str | UUID | None = None,
    ) -> dict[str, Any]:
        persona = self._require_active(persona_id)
        with connect(self._settings) as conn:
            user = find_user(conn, identifier)
        if user is None:
            raise AdminError(
                self._settings.admin_error_user_missing,
                status=404,
                reason="user_missing",
            )
        email = str(user["email"])
        if skip_org_join(self._settings, email):
            raise AdminError(
                self._settings.failure_message_engram_join,
                status=403,
                reason="engram_join_skipped",
            )
        stored = str(user["engram_user_id"])
        engine_member = self._ensure_org_member(email)
        engine_id = self._persist_people_id(user, stored, engine_member)
        user = {**user, "engram_user_id": engine_id}
        try:
            result = self._subscribe_engine(persona, engine_id)
        except ValidationError:
            engine_member = self._ensure_org_member(email)
            engine_id = self._persist_people_id(user, stored, engine_member)
            user = {**user, "engram_user_id": engine_id}
            try:
                result = self._subscribe_engine(persona, engine_id)
            except BrainError as exc:
                raise _brain_error(exc) from exc
        except ConflictError:
            result = {"already": True}
        except BrainError as exc:
            raise _brain_error(exc) from exc
        with connect(self._settings) as conn:
            upsert_subscription(
                conn,
                user_id=str(user["id"]),
                persona_id=str(persona["id"]),
                status=SUBSCRIPTION_ACTIVE,
            )
        return {
            "ok": True,
            "user": _row(user),
            "result": _jsonable(result),
        }

    def _ensure_org_member(self, email: str) -> OrgMember:
        try:
            if self._roster_factory is not None:
                roster = self._roster_factory(self._settings)
                try:
                    return ensure_org_member(roster, self._settings, email=email)
                finally:
                    roster.close()
            with open_org_roster(self._settings) as roster:
                return ensure_org_member(roster, self._settings, email=email)
        except BrainError as exc:
            raise _brain_error(exc) from exc

    def _member_secret_key(self) -> bytes | None:
        raw = self._settings.engram_member_secret_key
        if raw is None:
            return None
        try:
            return decode_member_secret_key(raw)
        except MemberSecretError:
            return None

    def _persist_people_id(
        self,
        user: dict[str, Any],
        stored: str,
        member: OrgMember,
    ) -> str:
        engine_id = persona_engine_user_id(member.user_id)
        key = self._member_secret_key()
        ciphertext = ciphertext_for_password(member.password, key=key)
        if (
            engine_id == persona_engine_user_id(stored)
            and ciphertext is None
        ):
            return engine_id
        with connect(self._settings) as conn:
            set_engram_user_id(
                conn,
                str(user["id"]),
                engine_id,
                member_secret=ciphertext,
            )
        return engine_id

    def _subscribe_engine(self, persona: dict[str, Any], engine_id: str) -> Any:
        with self._brain() as brain:
            return brain.subscribe(
                persona["engram_persona_id"],
                persona_engine_user_id(engine_id),
            )
