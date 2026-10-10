from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PersonaRecord:
    id: str
    org_id: str
    name: str
    handle: str | None
    description: str | None
    avatar_url: str | None
    status: str | None
    tenant: str | None
    created_at: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class ChatOutcome:
    messages: list[str]
    text: str
    memories_used: list[Any]
    session_id: str | None
    raw: dict[str, Any]
    brain_ms: int


@dataclass(frozen=True)
class IngestOutcome:
    gid: Any
    perception: Any
    incomplete: Any
    raw: dict[str, Any]


@dataclass(frozen=True)
class RetrieveHit:
    tenant: str | None
    text: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class RetrieveOutcome:
    results: list[RetrieveHit]
    raw: dict[str, Any]


class PersonaBrain(ABC):
    """Swappable persona memory surface. One instance per Engram user_id."""

    @abstractmethod
    def create_persona(
        self,
        name: str,
        handle: str,
        description: str,
    ) -> PersonaRecord:
        raise NotImplementedError

    @abstractmethod
    def get_persona(self, persona_id: str) -> PersonaRecord:
        raise NotImplementedError

    @abstractmethod
    def delete_persona(self, persona_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def teach(self, persona_id: str, text: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def answer(self, persona_id: str, question_key: str, text: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def questions(self, persona_id: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def ingest_shared_document(
        self,
        persona_id: str,
        document: Any,
        metadata: dict[str, Any] | None = None,
    ) -> IngestOutcome:
        raise NotImplementedError

    @abstractmethod
    def ingest_shared_text(
        self,
        persona_id: str,
        text: str,
        metadata: dict[str, Any] | None = None,
    ) -> IngestOutcome:
        raise NotImplementedError

    @abstractmethod
    def ingest_private_text(
        self,
        persona_id: str,
        text: str,
    ) -> IngestOutcome:
        raise NotImplementedError

    @abstractmethod
    def subscribe(self, persona_id: str, user_id: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def unsubscribe(self, persona_id: str, user_id: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def subscribers(self, persona_id: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def chat(
        self,
        persona_id: str,
        message: str,
        session_id: str | None = None,
    ) -> ChatOutcome:
        raise NotImplementedError

    @abstractmethod
    def retrieve(
        self,
        persona_id: str,
        query: str,
        *,
        top_k: int = 10,
    ) -> RetrieveOutcome:
        raise NotImplementedError

    @abstractmethod
    def retrieve_scoped(
        self,
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        raise NotImplementedError

    @abstractmethod
    def converse(
        self,
        persona_id: str,
        text: str,
        *,
        session_id: str | None = None,
        speaker: str | None = None,
    ) -> Any:
        """Record a turn in the caller's private pool without asking for a reply."""
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        raise NotImplementedError
