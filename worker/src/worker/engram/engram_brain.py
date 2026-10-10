from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, TypeVar

import httpx
from engram_sdk import _common as sdk_common
from engram_sdk.errors import ConflictError as SdkConflictError
from engram_sdk.errors import EngramAPIError, raise_for_status
from engram_sdk.errors import EngramError as SdkEngramError
from engram_sdk.errors import ForbiddenError as SdkForbiddenError
from engram_sdk.errors import NotFoundError as SdkNotFoundError
from engram_sdk.errors import PaymentRequiredError as SdkPaymentRequiredError
from engram_sdk.errors import ServerError as SdkServerError
from engram_sdk.errors import UnauthorizedError as SdkUnauthorizedError
from engram_sdk.errors import ValidationError as SdkValidationError
from engram_sdk.models import IngestResult, Persona, PersonaReply

from worker.config import WorkerSettings
from worker.engram import errors as app
from worker.engram.factory import create_engram, create_member_engram
from worker.engram.interface import (
    ChatOutcome,
    IngestOutcome,
    PersonaBrain,
    PersonaRecord,
    RetrieveHit,
    RetrieveOutcome,
)
from worker.engram.user_id import persona_engine_user_id

T = TypeVar("T")

_READ_RETRY_STATUSES = frozenset({429, 502, 503, 504})


def _backoff_seconds(attempt: int) -> float:
    return min(2.0, 0.2 * (2**attempt))


def _persona_record(persona: Persona) -> PersonaRecord:
    raw = persona.raw if isinstance(persona.raw, dict) else {}
    return PersonaRecord(
        id=persona.id,
        org_id=persona.org_id,
        name=persona.name,
        handle=persona.handle,
        description=persona.description,
        avatar_url=persona.avatar_url,
        status=persona.status,
        tenant=persona.tenant,
        created_at=persona.created_at,
        raw=raw,
    )


def _ingest_outcome(result: IngestResult) -> IngestOutcome:
    raw = result.raw if isinstance(result.raw, dict) else {}
    return IngestOutcome(
        gid=result.gid,
        perception=result.perception,
        incomplete=result.incomplete,
        raw=raw,
    )


def _flatten_messages(messages: list[str], join: str) -> str:
    return join.join(messages)


def _map_sdk_error(exc: SdkEngramError, *, chat: bool = False) -> app.BrainError:
    if isinstance(exc, SdkForbiddenError) and chat:
        return app.NotSubscribedError(
            str(exc),
            status=exc.status,
            detail=exc.detail,
        )
    mapping: list[tuple[type[SdkEngramError], type[app.BrainError]]] = [
        (SdkUnauthorizedError, app.UnauthorizedError),
        (SdkPaymentRequiredError, app.PaymentRequiredError),
        (SdkForbiddenError, app.ForbiddenError),
        (SdkNotFoundError, app.NotFoundError),
        (SdkConflictError, app.ConflictError),
        (SdkValidationError, app.ValidationError),
        (SdkServerError, app.ServerError),
    ]
    status = exc.status if isinstance(exc, EngramAPIError) else None
    detail = exc.detail if isinstance(exc, EngramAPIError) else None
    if status in _READ_RETRY_STATUSES:
        return app.RetryableReadError(str(exc), status=status, detail=detail)
    for sdk_cls, app_cls in mapping:
        if isinstance(exc, sdk_cls):
            return app_cls(str(exc), status=status, detail=detail)
    return app.BrainError(str(exc), status=status, detail=detail)


class EngramBrain(PersonaBrain):
    def __init__(
        self,
        settings: WorkerSettings,
        user_id: str,
        client: Any | None = None,
        *,
        api_key: str | None = None,
    ) -> None:
        self._settings = settings
        self._user_id = persona_engine_user_id(user_id)
        # Member session token when this brain talks as the member; None means
        # the org key (or a test-injected client). Never logged.
        self._member_token = api_key
        self._owned_http: httpx.Client | None = None
        self._owns_http = False
        if client is not None:
            self._client = client
        elif api_key is not None:
            self._client = create_member_engram(
                settings,
                self._user_id,
                api_key=api_key,
            )
        else:
            self._client = create_engram(settings, self._user_id)

    def uses_member_token(self, api_key: str | None) -> bool:
        return self._member_token == api_key

    def _retrieve_bearer(self) -> str:
        if self._member_token:
            return self._member_token
        key = self._settings.engram_api_key
        if not key:
            raise RuntimeError(
                "Engram is not configured (ENGRAM_API_KEY, ENGRAM_ORG_ID, "
                "ENGRAM_BASE_URL)",
            )
        return key

    def _http(self) -> httpx.Client:
        borrowed = getattr(self._client, "_client", None)
        if isinstance(borrowed, httpx.Client):
            return borrowed
        if self._owned_http is None:
            if self._settings.engram_base_url is None:
                raise RuntimeError(
                    "Engram is not configured (ENGRAM_API_KEY, ENGRAM_ORG_ID, "
                    "ENGRAM_BASE_URL)",
                )
            self._owned_http = httpx.Client(
                base_url=str(self._settings.engram_base_url),
                timeout=float(self._settings.engram_timeout_seconds),
            )
            self._owns_http = True
        return self._owned_http

    def _post_persona_retrieve(self, persona_id: str, body: dict[str, Any]) -> Any:
        if "user_id" in body:
            raise app.BrainError("scoped retrieve must not send user_id")
        org = self._settings.engram_org_id
        if not org:
            raise RuntimeError(
                "Engram is not configured (ENGRAM_API_KEY, ENGRAM_ORG_ID, "
                "ENGRAM_BASE_URL)",
            )
        path = (
            self._settings.engram_api_version_path.rstrip("/")
            + sdk_common.org_path(org, "personas", persona_id, "retrieve")
        )
        try:
            resp = self._http().request(
                "POST",
                path,
                json=body,
                headers=sdk_common.auth_headers(self._retrieve_bearer()),
            )
        except httpx.TransportError as exc:
            raise SdkEngramError(f"network error: {exc}") from exc
        parsed = sdk_common.parse_json(resp)
        raise_for_status(resp.status_code, parsed)
        return parsed

    def _parse_retrieve(self, payload: Any) -> RetrieveOutcome:
        raw = payload if isinstance(payload, dict) else {"value": payload}
        rows = raw.get("results")
        hits: list[RetrieveHit] = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                tenant = row.get("tenant")
                text = row.get("text")
                hits.append(
                    RetrieveHit(
                        tenant=tenant if isinstance(tenant, str) else None,
                        text=text if isinstance(text, str) else None,
                        raw=row,
                    ),
                )
        return RetrieveOutcome(results=hits, raw=raw)

    def _read(self, op: Callable[[], T]) -> T:
        attempts = 0
        while True:
            try:
                return op()
            except SdkEngramError as exc:
                status = exc.status if isinstance(exc, EngramAPIError) else None
                if (
                    status in _READ_RETRY_STATUSES
                    and attempts < self._settings.engram_read_max_retries
                ):
                    time.sleep(_backoff_seconds(attempts))
                    attempts += 1
                    continue
                raise _map_sdk_error(exc) from exc

    def _write(self, op: Callable[[], T], *, chat: bool = False) -> T:
        try:
            return op()
        except SdkEngramError as exc:
            raise _map_sdk_error(exc, chat=chat) from exc

    def create_persona(
        self,
        name: str,
        handle: str,
        description: str,
    ) -> PersonaRecord:
        persona = self._write(
            lambda: self._client.personas.create(
                name,
                handle=handle,
                description=description,
            ),
        )
        return _persona_record(persona)

    def get_persona(self, persona_id: str) -> PersonaRecord:
        persona = self._read(lambda: self._client.personas.get(persona_id))
        return _persona_record(persona)

    def delete_persona(self, persona_id: str) -> None:
        self._write(lambda: self._client.personas.delete(persona_id))

    def teach(self, persona_id: str, text: str) -> Any:
        return self._write(lambda: self._client.personas.teach(persona_id, text))

    def answer(self, persona_id: str, question_key: str, text: str) -> Any:
        return self._write(
            lambda: self._client.personas.answer(persona_id, question_key, text),
        )

    def questions(self, persona_id: str) -> Any:
        return self._read(lambda: self._client.personas.questions(persona_id))

    def ingest_shared_document(
        self,
        persona_id: str,
        document: Any,
        metadata: dict[str, Any] | None = None,
    ) -> IngestOutcome:
        result = self._write(
            lambda: self._client.personas.pool(persona_id, "shared").document(
                document,
                metadata=metadata,
            ),
        )
        return _ingest_outcome(result)

    def ingest_shared_text(
        self,
        persona_id: str,
        text: str,
        metadata: dict[str, Any] | None = None,
    ) -> IngestOutcome:
        result = self._write(
            lambda: self._client.personas.pool(persona_id, "shared").text(
                text,
                metadata=metadata,
            ),
        )
        return _ingest_outcome(result)

    def ingest_private_text(
        self,
        persona_id: str,
        text: str,
    ) -> IngestOutcome:
        result = self._write(
            lambda: self._client.personas.private(persona_id).text(text),
        )
        return _ingest_outcome(result)

    def subscribe(self, persona_id: str, user_id: str) -> Any:
        engine_user_id = persona_engine_user_id(user_id)
        return self._write(
            lambda: self._client.personas.subscribe(persona_id, engine_user_id),
        )

    def unsubscribe(self, persona_id: str, user_id: str) -> Any:
        engine_user_id = persona_engine_user_id(user_id)
        return self._write(
            lambda: self._client.personas.unsubscribe(persona_id, engine_user_id),
        )

    def subscribers(self, persona_id: str) -> Any:
        return self._read(lambda: self._client.personas.subscribers(persona_id))

    def chat(
        self,
        persona_id: str,
        message: str,
        session_id: str | None = None,
    ) -> ChatOutcome:
        started = time.perf_counter()
        reply = self._write(
            lambda: self._client.personas.chat(
                persona_id,
                message,
                session_id=session_id,
            ),
            chat=True,
        )
        brain_ms = int((time.perf_counter() - started) * 1000)
        if not isinstance(reply, PersonaReply):
            raise app.BrainError("chat returned an unexpected result")
        messages = list(reply.messages)
        raw = reply.raw if isinstance(reply.raw, dict) else {}
        return ChatOutcome(
            messages=messages,
            text=_flatten_messages(messages, self._settings.engram_message_join),
            memories_used=list(reply.memories_used),
            session_id=reply.session_id,
            raw=raw,
            brain_ms=brain_ms,
        )

    def retrieve(
        self,
        persona_id: str,
        query: str,
        *,
        top_k: int = 10,
    ) -> RetrieveOutcome:
        payload = self._read(
            lambda: self._client.personas.retrieve(persona_id, query, top_k=top_k),
        )
        return self._parse_retrieve(payload)

    def retrieve_scoped(
        self,
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        body = {
            "query": query,
            "top_k": top_k,
            "scope": scope,
        }
        payload = self._read(
            lambda: self._post_persona_retrieve(persona_id, body),
        )
        return self._parse_retrieve(payload)

    def converse(
        self,
        persona_id: str,
        text: str,
        *,
        session_id: str | None = None,
        speaker: str | None = None,
    ) -> Any:
        return self._write(
            lambda: self._client.personas.converse(
                persona_id,
                text,
                session_id=session_id,
                speaker=speaker,
            ),
        )

    def close(self) -> None:
        if self._owns_http and self._owned_http is not None:
            self._owned_http.close()
            self._owned_http = None
            self._owns_http = False
        self._client.close()
