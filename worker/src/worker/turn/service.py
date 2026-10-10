from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, NoReturn, TypeVar
from uuid import UUID, uuid4

import structlog
from structlog.contextvars import bind_contextvars, clear_contextvars

from worker.clients import create_openai
from worker.config import WorkerSettings
from worker.controller.controller import Controller
from worker.controller.decision import Action, Decision, ReasonCode, TurnSignals
from worker.engram.caller_facts import CallerFactExtractor, stamp_caller_fact
from worker.engram.closing import run_closing_pass
from worker.engram.errors import (
    BrainError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    NotSubscribedError,
    PaymentRequiredError,
    RetryableReadError,
    ServerError,
    UnauthorizedError,
    ValidationError,
)
from worker.engram.interface import (
    ChatOutcome,
    PersonaBrain,
    RetrieveHit,
    RetrieveOutcome,
)
from worker.engram.member_secret import (
    MemberSecretError,
    ciphertext_for_password,
    decode_member_secret_key,
    decrypt_member_secret,
)
from worker.engram.org_member import (
    OrgMember,
    ensure_org_member,
    open_org_roster,
    skip_org_join,
)
from worker.engram.registry import BrainRegistry
from worker.engram.scope_router import ScopeDecision, ScopeRouter
from worker.engram.session import MemberSessionCache, call_as_member, member_brain
from worker.engram.tenant import is_own_private_pool, is_shared_pool, may_ground
from worker.engram.user_id import persona_engine_user_id
from worker.notices import publish_notice, publish_trace
from worker.observe.fields import turn_log_fields
from worker.persistence.db import borrow
from worker.persistence.personas import get_persona, visible_to_members
from worker.persistence.receipts import (
    claim_write_receipt,
    claim_writeback,
    load_receipt_turn_ids,
    store_receipt_turn_ids,
)
from worker.persistence.sessions import (
    get_session,
    set_engram_session_id,
    set_user_engram_id,
    user_email,
    user_engram_id,
    user_engram_member_secret,
)
from worker.persistence.subscriptions import (
    has_active_subscription,
    upsert_active_subscription,
)
from worker.persistence.turns import (
    insert_latency_spans,
    insert_memory_refs,
    insert_turn,
    next_ordinal,
    recent_history,
)
from worker.quota.decision import is_owner_email, quota_applies_to_caller
from worker.quota.store import (
    load_quota_usage,
    log_quota_warn,
    refuse_quota,
    resolve_live_quota_limits,
)
from worker.reframe.answerer import Answerer
from worker.reframe.errors import ReframeError, ReframeUnavailableError
from worker.reframe.reframer import Reframer
from worker.reframe.types import HistoryTurn
from worker.schema import TURN_SPEAKER_PERSONA, TURN_SPEAKER_USER
from worker.turn.errors import TurnError
from worker.turn.grant import grant_persona_access, should_attempt_grant
from worker.turn.identity import (
    claimed_is_admit_placeholder,
    session_identity_reason,
    stored_engram_matches,
)

log = structlog.get_logger(__name__)

TOp = TypeVar("TOp")


def _empty_retrieve() -> RetrieveOutcome:
    return RetrieveOutcome(results=[], raw={})


def _drain(fut: Future[Any]) -> None:
    """Wait out a leg whose result we are about to discard."""
    try:
        fut.result()
    except BaseException:  # noqa: BLE001 - the caller's error is the real one
        pass


@dataclass(frozen=True)
class GroundedPools:
    persona_memories: list[str]
    caller_memories: list[str]
    outcome: ChatOutcome
    shared_hits: int
    shared_grounded: int
    shared_dropped: int
    private_hits: int
    private_grounded: int
    private_dropped: int

    @property
    def memories(self) -> list[str]:
        return [*self.persona_memories, *self.caller_memories]

    @property
    def hits(self) -> int:
        return self.shared_hits + self.private_hits

    @property
    def grounded(self) -> int:
        return self.shared_grounded + self.private_grounded

    @property
    def dropped(self) -> int:
        return self.shared_dropped + self.private_dropped

_BRAIN_HTTP: list[tuple[type[BrainError], int]] = [
    (NotSubscribedError, 403),
    (UnauthorizedError, 401),
    (PaymentRequiredError, 402),
    (ForbiddenError, 403),
    (NotFoundError, 404),
    (ValidationError, 422),
    (ConflictError, 409),
    (ServerError, 503),
    (RetryableReadError, 503),
]


def _brain_status(error: BrainError) -> int:
    for cls, status in _BRAIN_HTTP:
        if isinstance(error, cls):
            return status
    return error.status if error.status is not None else 502


def _voice_config(raw: object) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    return {}


def _persona_identity(
    persona: dict[str, Any],
    settings: WorkerSettings,
) -> dict[str, Any]:
    """Who the persona is, from the local catalog row.

    Engram grounds a `chat` reply on the persona's own name and description.
    The retrieve path composes the reply here, so it has to be told the same
    thing or the persona cannot answer about itself from anything but a
    memory that happens to state it in the first person.
    """
    identity: dict[str, Any] = {}
    name = persona.get("display_name")
    if isinstance(name, str) and name.strip():
        identity[settings.persona_identity_name_key] = name.strip()
    description = persona.get("description")
    if isinstance(description, str) and description.strip():
        identity[settings.persona_identity_description_key] = description.strip()
    return identity


@dataclass(frozen=True)
class TurnResult:
    action: str
    reply_text: str | None
    session_id: UUID
    engram_session_id: str | None
    turn_ids: list[UUID]
    reasons: list[str]
    correlation_id: UUID
    recorded: bool = True
    warning: str | None = None
    warning_code: str | None = None


@dataclass
class TurnPlan:
    """Everything a turn needs after the brain has answered.

    Held between `begin` and `finish` so no database connection and no session
    lock is held across the Engram call or the reframe.
    """

    session_id: UUID
    text: str
    started: float
    decision: Decision
    prior_sid: str | None
    voice_config: dict[str, Any]
    persona_identity: dict[str, Any]
    history: list[HistoryTurn]
    correlation_id: UUID
    mode: str = "chat"
    memories: list[str] = field(default_factory=list)
    persona_memories: list[str] = field(default_factory=list)
    caller_memories: list[str] = field(default_factory=list)
    engram_user_id: str | None = None
    engram_persona_id: str | None = None
    outcome: ChatOutcome | None = None
    reframe_ms: int | None = None
    reframe_first_token_ms: int | None = None
    spoken: str | None = None
    retrieve_hits: int | None = None
    retrieve_hits_grounded: int | None = None
    retrieve_hits_dropped: int | None = None
    retrieve_hits_shared: int | None = None
    retrieve_hits_shared_grounded: int | None = None
    retrieve_hits_shared_dropped: int | None = None
    retrieve_hits_private: int | None = None
    retrieve_hits_private_grounded: int | None = None
    retrieve_hits_private_dropped: int | None = None
    member_authenticated: bool = False
    engram_credential: str | None = None
    app_user_id: UUID | None = None
    retrieve_scope: str | None = None
    retrieve_scope_reason: str | None = None
    speaks: bool = field(init=False)

    def __post_init__(self) -> None:
        self.speaks = self.decision.action is Action.SPEAK

    @property
    def brain_ms(self) -> int | None:
        return self.outcome.brain_ms if self.outcome is not None else None

    @property
    def engram_session_id(self) -> str | None:
        if self.outcome is not None and self.outcome.session_id:
            return self.outcome.session_id
        return self.prior_sid

    def total_ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)


class TurnRunner:
    def __init__(self, settings: WorkerSettings) -> None:
        self._settings = settings
        self._controller = Controller()
        self._brains = BrainRegistry(settings)
        self._member_brains = BrainRegistry(settings)
        self._sessions = MemberSessionCache(settings)
        # The write-back must not hold the reply's connection open, so it runs
        # on its own small pool once the words are already out.
        self._writers = ThreadPoolExecutor(
            max_workers=settings.engram_writeback_workers,
            thread_name_prefix="engram-writeback",
        )
        # Reads are on the path to first word and must never queue behind a
        # write-back, so they get their own pool. Sharing one would put a
        # private write in front of the next turn's retrieve.
        self._readers = ThreadPoolExecutor(
            max_workers=settings.engram_retrieve_workers,
            thread_name_prefix="engram-retrieve",
        )
        # The classifier sits on the path to first word with the retrieves,
        # so it must not share the write-back pool or the retrieve pool.
        self._routers = ThreadPoolExecutor(
            max_workers=settings.engram_scope_router_workers,
            thread_name_prefix="engram-scope",
        )
        self._openai: Any | None = None
        self._reframer: Reframer | None = None
        self._answerer: Answerer | None = None
        self._scope_router: ScopeRouter | None = None
        self._extractor: CallerFactExtractor | None = None
        self._grant_tried: set[tuple[str, str]] = set()

    def _llm(self) -> Any:
        if self._openai is None:
            try:
                self._openai = create_openai(self._settings)
            except RuntimeError as exc:
                raise ReframeUnavailableError(str(exc)) from exc
        return self._openai

    def _reframe_client(self) -> Reframer:
        if self._reframer is None:
            self._reframer = Reframer(self._settings, self._llm())
        return self._reframer

    def _answer_client(self) -> Answerer:
        if self._answerer is None:
            self._answerer = Answerer(self._settings, self._llm())
        return self._answerer

    def _scope_client(self) -> ScopeRouter:
        if self._scope_router is None:
            client: Any | None
            try:
                client = self._llm()
            except ReframeUnavailableError:
                client = None
            self._scope_router = ScopeRouter(self._settings, client)
        return self._scope_router

    def _extract_client(self) -> CallerFactExtractor:
        if self._extractor is None:
            client: Any | None
            try:
                client = self._llm()
            except ReframeUnavailableError:
                client = None
            self._extractor = CallerFactExtractor(self._settings, client)
        return self._extractor

    def run(
        self,
        *,
        app_user_id: UUID,
        engram_user_id: str,
        persona_id: UUID,
        session_id: UUID,
        text: str,
        correlation_id: UUID | None = None,
    ) -> TurnResult:
        plan = self.begin(
            app_user_id=app_user_id,
            engram_user_id=engram_user_id,
            persona_id=persona_id,
            session_id=session_id,
            text=text,
            correlation_id=correlation_id,
        )
        if plan.speaks:
            self.speak(plan)
        return self.finish(plan)

    def begin(
        self,
        *,
        app_user_id: UUID,
        engram_user_id: str,
        persona_id: UUID,
        session_id: UUID,
        text: str,
        correlation_id: UUID | None = None,
    ) -> TurnPlan:
        """Validate, ask the brain, and decide. Raises `TurnError` before any
        reply byte is produced, so the caller can still choose a status code."""
        started = time.perf_counter()
        traced = correlation_id or uuid4()
        bind_contextvars(
            correlation_id=str(traced),
            session_id=str(session_id),
        )
        try:
            return self._begin(
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                persona_id=persona_id,
                session_id=session_id,
                text=text,
                started=started,
                correlation_id=traced,
            )
        except Exception:
            clear_contextvars()
            raise

    def _begin(
        self,
        *,
        app_user_id: UUID,
        engram_user_id: str,
        persona_id: UUID,
        session_id: UUID,
        text: str,
        started: float,
        correlation_id: UUID,
    ) -> TurnPlan:
        mirrored = False
        try:
            with borrow(self._settings) as conn:
                # Locked only for these local reads: it makes two turns that start
                # at once share one Engram thread instead of minting one each.
                session = get_session(conn, session_id, for_update=True)
                if session is None:
                    raise TurnError(
                        "session not found",
                        status=404,
                        reason="session_not_found",
                    )
                if session["ended_at"] is not None:
                    raise TurnError(
                        "session has ended",
                        status=409,
                        reason="session_ended",
                    )
                stored_engram = user_engram_id(conn, app_user_id)
                mismatch = session_identity_reason(
                    session_user_id=UUID(str(session["user_id"])),
                    session_persona_id=UUID(str(session["persona_id"])),
                    stored_engram_user_id=stored_engram,
                    claimed_app_user_id=app_user_id,
                    claimed_persona_id=persona_id,
                    claimed_engram_user_id=engram_user_id,
                )
                if mismatch is not None or not stored_engram:
                    raise TurnError(
                        "forbidden",
                        status=403,
                        reason=mismatch or "identity_mismatch",
                    )
                # Bind the stored People id, not a stale voice header.
                engram_user_id = persona_engine_user_id(stored_engram)

                email = user_email(conn, app_user_id)
                if quota_applies_to_caller(
                    owner=is_owner_email(email or "", self._settings.owner_emails),
                ):
                    limits = resolve_live_quota_limits(conn, self._settings)
                    usage = load_quota_usage(conn, app_user_id, limits)
                    refused = refuse_quota(self._settings, usage, limits)
                    if refused is not None:
                        log.warning(
                            self._settings.quota_log_refused,
                            user_id=str(app_user_id),
                            kind=refused["kind"],
                            used=refused["used"],
                            limit=refused["limit"],
                        )
                        raise TurnError(
                            str(refused["error"]),
                            status=429,
                            reason=str(refused["code"]),
                            code=str(refused["code"]),
                            reset_at=usage.reset_at,
                        )
                    log_quota_warn(self._settings, app_user_id, usage, limits)

                persona = visible_to_members(get_persona(conn, persona_id))
                if persona is None:
                    raise TurnError(
                        self._settings.persona_error_not_found,
                        status=404,
                        reason="persona_not_found",
                    )
                engram_persona_id = persona["engram_persona_id"]
                if not isinstance(engram_persona_id, str) or not engram_persona_id:
                    raise TurnError("persona is missing Engram id", status=500)

                prior_sid = session["engram_session_id"]
                if prior_sid is not None and not isinstance(prior_sid, str):
                    prior_sid = None
                if not prior_sid:
                    # Engram treats the conversation id as an opaque caller-chosen
                    # key. Claiming it here keeps one thread per app session.
                    prior_sid = uuid4().hex
                    set_engram_session_id(conn, session_id, prior_sid)
                    conn.commit()
                voice_config = _voice_config(persona["voice_config"])
                identity = _persona_identity(persona, self._settings)
                history = recent_history(
                    conn,
                    session_id,
                    self._settings.reframe_history_turns,
                )
                mirrored = has_active_subscription(
                    conn,
                    app_user_id,
                    persona_id,
                )
        except TurnError:
            raise
        except Exception as exc:
            log.exception("turn could not start", session_id=str(session_id))
            raise TurnError(
                self._settings.failure_message_database,
                status=503,
                reason="database_unavailable",
                code=self._settings.failure_code_database,
            ) from exc

        signals = TurnSignals(has_inbound_text=bool(text.strip()))
        halted = self._controller.pre(signals)
        if halted is not None:
            return TurnPlan(
                session_id=session_id,
                text=text,
                started=started,
                decision=halted,
                prior_sid=prior_sid,
                voice_config=voice_config,
                persona_identity=identity,
                history=history,
                correlation_id=correlation_id,
                mode=self._settings.brain_mode,
            )

        brain = self._brains.get(engram_user_id)
        pair = (str(app_user_id), str(persona_id))
        if should_attempt_grant(
            mirrored=mirrored,
            already_tried=pair in self._grant_tried,
        ):
            engine_user_id = self._join_and_subscribe(
                app_user_id=app_user_id,
                email=email or "",
                stored_engram_user_id=engram_user_id,
                engram_persona_id=engram_persona_id,
                persona_id=persona_id,
            )
            self._grant_tried.add(pair)
            engram_user_id = engine_user_id
            brain = self._brains.get(engram_user_id)

        brain, member_authenticated, credential = self._resolve_member_client(
            app_user_id=app_user_id,
            engram_user_id=engram_user_id,
            email=email or "",
        )
        mode = self._conversation_mode(member_authenticated)
        memories: list[str] = []
        hit_counts: GroundedPools | None = None
        retrieve_scope: str | None = None
        retrieve_scope_reason: str | None = None
        outcome: ChatOutcome | BrainError
        try:
            if mode == "retrieve":
                # Read each pool separately so the answerer can tell them
                # apart. The classifier runs beside those reads and may
                # only drop a list afterwards.
                grounded, scope_decision, member_authenticated = (
                    self._retrieve_grounded(
                        brain,
                        member_authenticated=member_authenticated,
                        app_user_id=app_user_id,
                        engram_user_id=engram_user_id,
                        email=email or "",
                        engram_persona_id=engram_persona_id,
                        query=text,
                        prior_sid=prior_sid,
                    )
                )
                if not member_authenticated:
                    credential = self._settings.engram_credential_org
                    brain = self._brains.get(engram_user_id)
                memories = grounded.memories
                outcome = grounded.outcome
                hit_counts = grounded
                retrieve_scope = scope_decision.scope
                retrieve_scope_reason = scope_decision.reason
            else:
                outcome = self._run_member_op(
                    brain,
                    member_authenticated=member_authenticated,
                    app_user_id=app_user_id,
                    engram_user_id=engram_user_id,
                    email=email or "",
                    op=lambda active: active.chat(
                        engram_persona_id,
                        text,
                        session_id=prior_sid,
                    ),
                )
                if outcome is None:
                    member_authenticated = False
                    credential = self._settings.engram_credential_org
                    mode = self._conversation_mode(False)
                    brain = self._brains.get(engram_user_id)
                    grounded, scope_decision, member_authenticated = (
                        self._retrieve_grounded(
                            brain,
                            member_authenticated=False,
                            app_user_id=app_user_id,
                            engram_user_id=engram_user_id,
                            email=email or "",
                            engram_persona_id=engram_persona_id,
                            query=text,
                            prior_sid=prior_sid,
                        )
                    )
                    memories = grounded.memories
                    outcome = grounded.outcome
                    hit_counts = grounded
                    retrieve_scope = scope_decision.scope
                    retrieve_scope_reason = scope_decision.reason
        except BrainError as exc:
            outcome = exc

        decision = self._controller.decide(outcome, signals)
        if retrieve_scope is not None and not isinstance(outcome, BrainError):
            decision = self._decision_after_scope(decision, retrieve_scope)
        if isinstance(outcome, BrainError):
            plan = TurnPlan(
                session_id=session_id,
                text=text,
                started=started,
                decision=decision,
                prior_sid=prior_sid,
                voice_config=voice_config,
                persona_identity=identity,
                history=history,
                correlation_id=correlation_id,
                mode=mode,
                member_authenticated=member_authenticated,
                engram_credential=credential,
                app_user_id=app_user_id,
            )
            log.error(
                "engram failed",
                session_id=str(session_id),
                error=str(outcome),
                status=_brain_status(outcome),
            )
            recorded = self.finish(plan)
            if not recorded.recorded:
                log.error(
                    "silence turn was not recorded after brain failure",
                    session_id=str(session_id),
                )
            publish_notice(
                self._settings,
                session_id,
                self._settings.failure_code_engram,
                self._settings.failure_message_engram,
            )
            raise TurnError(
                self._settings.failure_message_engram,
                status=_brain_status(outcome),
                reason=(
                    decision.reasons[0].value if decision.reasons else "brain_error"
                ),
                code=self._settings.failure_code_engram,
            ) from outcome

        return TurnPlan(
            session_id=session_id,
            text=text,
            started=started,
            decision=decision,
            prior_sid=prior_sid,
            voice_config=voice_config,
            persona_identity=identity,
            history=history,
            correlation_id=correlation_id,
            mode=mode,
            memories=memories,
            persona_memories=[] if hit_counts is None else hit_counts.persona_memories,
            caller_memories=[] if hit_counts is None else hit_counts.caller_memories,
            outcome=outcome,
            engram_user_id=engram_user_id,
            engram_persona_id=engram_persona_id,
            retrieve_hits=None if hit_counts is None else hit_counts.hits,
            retrieve_hits_grounded=(
                None if hit_counts is None else hit_counts.grounded
            ),
            retrieve_hits_dropped=None if hit_counts is None else hit_counts.dropped,
            retrieve_hits_shared=(
                None if hit_counts is None else hit_counts.shared_hits
            ),
            retrieve_hits_shared_grounded=(
                None if hit_counts is None else hit_counts.shared_grounded
            ),
            retrieve_hits_shared_dropped=(
                None if hit_counts is None else hit_counts.shared_dropped
            ),
            retrieve_hits_private=(
                None if hit_counts is None else hit_counts.private_hits
            ),
            retrieve_hits_private_grounded=(
                None if hit_counts is None else hit_counts.private_grounded
            ),
            retrieve_hits_private_dropped=(
                None if hit_counts is None else hit_counts.private_dropped
            ),
            member_authenticated=member_authenticated,
            engram_credential=credential,
            app_user_id=app_user_id,
            retrieve_scope=retrieve_scope,
            retrieve_scope_reason=retrieve_scope_reason,
        )

    def speak(self, plan: TurnPlan) -> str:
        """Reframe in one shot. Used where nothing is waiting on first token."""
        if not plan.speaks or plan.outcome is None:
            raise TurnError("turn does not speak", status=500, reason="not_speaking")
        started = time.perf_counter()
        try:
            if plan.mode == "retrieve":
                spoken = self._answer_client().answer(
                    persona_memories=plan.persona_memories,
                    caller_memories=plan.caller_memories,
                    persona_identity=plan.persona_identity,
                    history=plan.history,
                    question=plan.text,
                    voice_config=plan.voice_config,
                )
            else:
                spoken = self._reframe_client().reframe(
                    plan.outcome.messages,
                    plan.history,
                    plan.voice_config,
                )
        except ReframeError as exc:
            self._fail_reframe(plan, exc)
        plan.reframe_ms = int((time.perf_counter() - started) * 1000)
        plan.reframe_first_token_ms = plan.reframe_ms
        plan.spoken = spoken
        return spoken

    def stream_speak(self, plan: TurnPlan) -> Iterator[str]:
        """Reframe token by token so the listener hears the first words sooner.

        The caller must drain this fully and then call `finish`.
        """
        if not plan.speaks or plan.outcome is None:
            raise TurnError("turn does not speak", status=500, reason="not_speaking")
        started = time.perf_counter()
        pieces: list[str] = []
        pieces_source = (
            self._answer_client().stream(
                persona_memories=plan.persona_memories,
                caller_memories=plan.caller_memories,
                persona_identity=plan.persona_identity,
                history=plan.history,
                question=plan.text,
                voice_config=plan.voice_config,
            )
            if plan.mode == "retrieve"
            else self._reframe_client().stream(
                plan.outcome.messages,
                plan.history,
                plan.voice_config,
            )
        )
        try:
            for piece in pieces_source:
                if plan.reframe_first_token_ms is None:
                    plan.reframe_first_token_ms = int(
                        (time.perf_counter() - started) * 1000
                    )
                pieces.append(piece)
                yield piece
        finally:
            # Keep whatever was actually spoken, even if the stream broke.
            plan.reframe_ms = int((time.perf_counter() - started) * 1000)
            spoken = "".join(pieces).strip()
            plan.spoken = spoken or None

    def _fail_reframe(self, plan: TurnPlan, exc: ReframeError) -> NoReturn:
        log.error(
            "speaking llm failed",
            session_id=str(plan.session_id),
            error=str(exc),
        )
        plan.spoken = None
        self.finish(plan)
        publish_notice(
            self._settings,
            plan.session_id,
            self._settings.failure_code_speaking_llm,
            self._settings.failure_message_speaking_llm,
        )
        raise TurnError(
            self._settings.failure_message_speaking_llm,
            status=exc.status or 502,
            reason="reframe_failed",
            code=self._settings.failure_code_speaking_llm,
        ) from exc

    def finish(self, plan: TurnPlan) -> TurnResult:
        """Write the canonical record. Runs after the reply has been delivered.

        A persist failure is logged and returned, never raised: the reply has
        already gone out.
        """
        total_ms = plan.total_ms()
        outcome = plan.outcome
        spoken = plan.spoken
        next_sid = plan.engram_session_id
        turn_ids: list[UUID] = []
        recorded = True
        warning: str | None = None
        warning_code: str | None = None
        try:
            with borrow(self._settings) as conn:
                # Lock only for the ordinal + insert window, never across the brain.
                get_session(conn, plan.session_id, for_update=True)
                if outcome is not None and isinstance(next_sid, str) and next_sid:
                    set_engram_session_id(conn, plan.session_id, next_sid)
                turn_ids = self._persist(
                    conn,
                    session_id=plan.session_id,
                    user_text=plan.text,
                    decision=plan.decision,
                    spoken=spoken,
                    outcome=outcome,
                    engram_session_id=next_sid,
                    brain_ms=plan.brain_ms,
                    reframe_ms=plan.reframe_ms,
                    reframe_first_token_ms=plan.reframe_first_token_ms,
                    total_ms=total_ms,
                    mode=plan.mode,
                    correlation_id=plan.correlation_id,
                    retrieve_scope=plan.retrieve_scope,
                    retrieve_scope_reason=plan.retrieve_scope_reason,
                )
                conn.commit()
        except Exception:
            recorded = False
            warning = self._settings.failure_message_record
            warning_code = self._settings.failure_code_record
            log.exception(
                "turn was not recorded",
                session_id=str(plan.session_id),
            )
        if recorded:
            publish_trace(
                self._settings,
                plan.session_id,
                plan.correlation_id,
                turn_ids,
            )
        if self._should_write_back(plan):
            self._writers.submit(self._write_back, plan)
        result = TurnResult(
            action=plan.decision.action.value,
            reply_text=spoken,
            session_id=plan.session_id,
            engram_session_id=next_sid if isinstance(next_sid, str) else None,
            turn_ids=turn_ids,
            reasons=[reason.value for reason in plan.decision.reasons],
            correlation_id=plan.correlation_id,
            recorded=recorded,
            warning=warning,
            warning_code=warning_code,
        )
        log.info(
            self._settings.log_turn_event,
            **turn_log_fields(
                self._settings,
                {
                    "correlation_id": str(result.correlation_id),
                    "session_id": str(plan.session_id),
                    "action": result.action,
                    "reasons": result.reasons,
                    "turn_ids": [str(turn_id) for turn_id in result.turn_ids],
                    "brain_ms": plan.brain_ms,
                    "reframe_ms": plan.reframe_ms,
                    "reframe_first_token_ms": plan.reframe_first_token_ms,
                    "brain_mode": plan.mode,
                    "recorded": result.recorded,
                    "retrieve_hits": plan.retrieve_hits,
                    "retrieve_hits_grounded": plan.retrieve_hits_grounded,
                    "retrieve_hits_dropped": plan.retrieve_hits_dropped,
                    "retrieve_hits_shared": plan.retrieve_hits_shared,
                    "retrieve_hits_shared_grounded": (
                        plan.retrieve_hits_shared_grounded
                    ),
                    "retrieve_hits_shared_dropped": (
                        plan.retrieve_hits_shared_dropped
                    ),
                    "retrieve_hits_private": plan.retrieve_hits_private,
                    "retrieve_hits_private_grounded": (
                        plan.retrieve_hits_private_grounded
                    ),
                    "retrieve_hits_private_dropped": (
                        plan.retrieve_hits_private_dropped
                    ),
                    "member_authenticated": plan.member_authenticated,
                    "engram_credential": plan.engram_credential,
                    "retrieve_scope": plan.retrieve_scope,
                    "retrieve_scope_reason": plan.retrieve_scope_reason,
                },
            ),
        )
        clear_contextvars()
        return result

    def _join_and_subscribe(
        self,
        *,
        app_user_id: UUID,
        email: str,
        stored_engram_user_id: str,
        engram_persona_id: str,
        persona_id: UUID,
    ) -> str:
        if skip_org_join(self._settings, email) or not email.strip():
            raise TurnError(
                self._settings.failure_message_engram_join,
                status=403,
                reason="engram_join_skipped",
                code=self._settings.failure_code_engram_join,
            )
        engine_member = self._ensure_org_member(email)
        engine_id = self._persist_engram_member(
            app_user_id,
            stored_engram_user_id,
            engine_member,
        )
        granted = grant_persona_access(
            self._brains.get(engine_id),
            self._settings,
            engram_persona_id=engram_persona_id,
            engram_user_id=engine_id,
        )
        if granted.reason == "validation":
            engine_member = self._ensure_org_member(email)
            engine_id = self._persist_engram_member(
                app_user_id,
                stored_engram_user_id,
                engine_member,
            )
            granted = grant_persona_access(
                self._brains.get(engine_id),
                self._settings,
                engram_persona_id=engram_persona_id,
                engram_user_id=engine_id,
            )
        if not granted.subscribed:
            raise TurnError(
                self._settings.failure_message_engram_join,
                status=granted.status if granted.status is not None else 502,
                reason=granted.reason or "engram_join_failed",
                code=self._settings.failure_code_engram_join,
            )
        if granted.mirror:
            try:
                with borrow(self._settings) as conn:
                    upsert_active_subscription(
                        conn,
                        app_user_id,
                        persona_id,
                    )
                    conn.commit()
            except Exception:
                log.warning(self._settings.log_subscribe_failed)
        return engine_id

    def _ensure_org_member(self, email: str) -> OrgMember:
        try:
            with open_org_roster(self._settings) as roster:
                return ensure_org_member(roster, self._settings, email=email)
        except BrainError as exc:
            log.warning(self._settings.log_engram_join_failed, status=exc.status)
            raise TurnError(
                self._settings.failure_message_engram_join,
                status=exc.status if exc.status is not None else 502,
                reason="engram_join_failed",
                code=self._settings.failure_code_engram_join,
            ) from exc

    def _member_secret_key(self) -> bytes | None:
        raw = self._settings.engram_member_secret_key
        if raw is None:
            return None
        try:
            return decode_member_secret_key(raw)
        except MemberSecretError:
            return None

    def _load_member_password(self, app_user_id: UUID) -> str | None:
        try:
            with borrow(self._settings) as conn:
                blob = user_engram_member_secret(conn, app_user_id)
        except Exception:
            return None
        if blob is None:
            return None
        key = self._member_secret_key()
        if key is None:
            return None
        try:
            return decrypt_member_secret(blob, key=key)
        except MemberSecretError:
            log.warning(
                self._settings.log_engram_credential_unavailable,
                reason="decrypt_failed",
            )
            return None

    def _resolve_member_client(
        self,
        *,
        app_user_id: UUID,
        engram_user_id: str,
        email: str,
    ) -> tuple[PersonaBrain, bool, str]:
        org = self._brains.get(engram_user_id)
        org_label = self._settings.engram_credential_org
        if not self._settings.engram_member_session_auth:
            return org, False, org_label
        if not email.strip():
            try:
                with borrow(self._settings) as conn:
                    loaded = user_email(conn, app_user_id)
            except Exception:
                loaded = None
            email = loaded or ""
        brain = member_brain(
            self._sessions,
            self._member_brains,
            engram_user_id=engram_user_id,
            email=email,
            password_provider=lambda: self._load_member_password(app_user_id),
        )
        if brain is None:
            return org, False, org_label
        return brain, True, self._settings.engram_credential_member

    def _conversation_mode(self, member_authenticated: bool) -> str:
        if member_authenticated:
            return self._settings.brain_mode
        return "retrieve"

    def _run_member_op(
        self,
        brain: PersonaBrain | None,
        *,
        member_authenticated: bool,
        app_user_id: UUID,
        engram_user_id: str,
        email: str,
        op: Callable[[PersonaBrain], TOp],
    ) -> TOp | None:
        if not member_authenticated:
            if brain is None:
                return None
            return op(brain)
        return call_as_member(
            self._sessions,
            self._member_brains,
            engram_user_id=engram_user_id,
            email=email,
            password_provider=lambda: self._load_member_password(app_user_id),
            op=op,
        )

    def _persist_engram_member(
        self,
        app_user_id: UUID,
        stored_engram_user_id: str,
        member: OrgMember,
    ) -> str:
        engine_id = persona_engine_user_id(member.user_id)
        key = self._member_secret_key()
        if member.password is not None and key is None:
            log.warning(
                self._settings.log_engram_credential_unavailable,
                reason="secret_key_missing",
                engram_user_id=engine_id,
            )
        ciphertext = ciphertext_for_password(member.password, key=key)
        if (
            member.password is not None
            and key is not None
            and ciphertext is None
        ):
            log.warning(
                self._settings.log_engram_credential_unavailable,
                reason="encrypt_failed",
                engram_user_id=engine_id,
            )
        if (
            engine_id == persona_engine_user_id(stored_engram_user_id)
            and ciphertext is None
        ):
            return engine_id
        try:
            with borrow(self._settings) as conn:
                set_user_engram_id(
                    conn,
                    app_user_id,
                    engine_id,
                    member_secret=ciphertext,
                )
                conn.commit()
        except Exception as exc:
            log.warning(self._settings.log_engram_join_failed)
            raise TurnError(
                self._settings.failure_message_database,
                status=503,
                reason="database_unavailable",
                code=self._settings.failure_code_database,
            ) from exc
        return engine_id

    def _should_write_back(self, plan: TurnPlan) -> bool:
        # Private Engram writes are extracted caller facts on the member JWT.
        # This gate still decides who would write (authenticated retrieve).
        # A degraded or flag-off turn is still the org key, so write-back
        # stays off (docs/ENGRAM.md §2.3). Gated on this plan, not the global
        # setting.
        if not plan.member_authenticated:
            return False
        # chat writes the caller's private pool itself; only retrieve owes one.
        if plan.mode != "retrieve":
            return False
        if not self._settings.engram_converse_writeback:
            return False
        return bool(plan.engram_user_id and plan.engram_persona_id)

    def _write_back(self, plan: TurnPlan) -> None:
        """Off the reply path. Extract caller facts; never converse the sitting.

        Postgres already recorded the turn via write_receipts. Claiming
        writeback_at keeps a retried think from extracting twice. Timeout,
        error, or unrecognised JSON writes nothing extra. Empty facts is
        success. Never dump user text or spoken reply.
        """
        settings = self._settings
        if not plan.member_authenticated or plan.app_user_id is None:
            log.warning(
                settings.log_engram_writeback,
                session_id=str(plan.session_id),
                reason=settings.engram_writeback_reason_unauthenticated,
            )
            return
        if not plan.engram_user_id or not plan.engram_persona_id:
            return
        try:
            with borrow(settings) as conn:
                claimed = claim_writeback(
                    conn,
                    plan.session_id,
                    plan.correlation_id,
                )
                conn.commit()
            if not claimed:
                return
        except Exception:
            log.warning(
                settings.log_engram_writeback,
                session_id=str(plan.session_id),
                reason=settings.engram_writeback_reason_claim_failed,
            )
            return
        extracted = self._extract_client().extract(
            history=plan.history,
            user_turn=plan.text,
            persona_reply=plan.spoken or "",
        )
        if extracted.reason not in {
            settings.caller_fact_reason_empty,
            settings.caller_fact_reason_extracted,
        }:
            log.info(
                settings.log_engram_writeback,
                session_id=str(plan.session_id),
                reason=extracted.reason,
            )
            return
        if not extracted.facts:
            log.info(
                settings.log_engram_writeback,
                session_id=str(plan.session_id),
                reason=settings.caller_fact_reason_empty,
            )
            return
        email = ""
        try:
            with borrow(settings) as conn:
                loaded = user_email(conn, plan.app_user_id)
            email = loaded or ""
        except Exception:
            log.warning(
                settings.log_engram_writeback,
                session_id=str(plan.session_id),
                reason=settings.engram_writeback_reason_unauthenticated,
            )
            return
        written = 0
        for fact in extracted.facts:
            try:
                stored = self._run_member_op(
                    None,
                    member_authenticated=True,
                    app_user_id=plan.app_user_id,
                    engram_user_id=plan.engram_user_id,
                    email=email,
                    op=lambda active, body=stamp_caller_fact(
                        fact,
                        settings,
                    ): active.ingest_private_text(
                        plan.engram_persona_id,
                        body,
                    ),
                )
                if stored is None:
                    log.warning(
                        settings.log_engram_writeback,
                        session_id=str(plan.session_id),
                        reason=settings.engram_writeback_reason_unauthenticated,
                    )
                    return
                written += 1
            except BrainError:
                log.warning(
                    settings.log_engram_writeback,
                    session_id=str(plan.session_id),
                    reason=settings.engram_writeback_reason_write_failed,
                )
                return
            except Exception:  # noqa: BLE001 - a writer thread must not die
                log.warning(
                    settings.log_engram_writeback,
                    session_id=str(plan.session_id),
                    reason=settings.engram_writeback_reason_write_failed,
                )
                return
        log.info(
            settings.log_engram_writeback,
            session_id=str(plan.session_id),
            reason=settings.caller_fact_reason_extracted,
            fact_count=written,
        )

    def enqueue_closing_pass(self, session_id: UUID, app_user_id: UUID) -> None:
        """Queue the hang-up extract. Must not sit on the path to first word."""
        self._writers.submit(self._closing_pass, session_id, app_user_id)

    def _closing_pass(self, session_id: UUID, app_user_id: UUID) -> None:
        try:
            run_closing_pass(self, session_id, app_user_id)
        except Exception:  # noqa: BLE001 - a writer thread must not die
            log.exception(
                self._settings.log_engram_closing,
                session_id=str(session_id),
                reason=self._settings.engram_writeback_reason_write_failed,
            )

    def _start_scope_router(
        self,
        question: str,
        *,
        member_authenticated: bool,
    ) -> Future[ScopeDecision] | None:
        """Submit the classifier without waiting. None means it did not run."""
        if not self._settings.engram_scope_router_enabled:
            return None
        if not member_authenticated:
            return None
        return self._routers.submit(self._scope_client().decide, question)

    def _await_scope_decision(
        self,
        fut: Future[ScopeDecision] | None,
        *,
        started: float,
        member_authenticated: bool,
    ) -> ScopeDecision:
        settings = self._settings
        both = settings.engram_retrieve_scope_both
        if not member_authenticated:
            if fut is not None:
                _drain(fut)
            return ScopeDecision(
                both,
                settings.engram_scope_router_reason_unauthenticated,
            )
        if fut is None:
            return ScopeDecision(
                both,
                settings.engram_scope_router_reason_disabled,
            )
        elapsed = time.perf_counter() - started
        remaining = settings.engram_scope_router_timeout_seconds - elapsed
        try:
            if fut.done():
                return self._canonical_scope_decision(fut.result())
            if remaining <= 0:
                return ScopeDecision(
                    both,
                    settings.engram_scope_router_reason_timeout,
                )
            return self._canonical_scope_decision(fut.result(timeout=remaining))
        except TimeoutError:
            return ScopeDecision(
                both,
                settings.engram_scope_router_reason_timeout,
            )
        except Exception:  # noqa: BLE001 - fail open; never starve a turn
            return ScopeDecision(
                both,
                settings.engram_scope_router_reason_error,
            )

    def _canonical_scope_decision(self, decision: ScopeDecision) -> ScopeDecision:
        settings = self._settings
        allowed = {
            settings.engram_retrieve_scope_shared,
            settings.engram_retrieve_scope_private,
            settings.engram_retrieve_scope_both,
        }
        if decision.scope in allowed:
            return decision
        return ScopeDecision(
            settings.engram_retrieve_scope_both,
            settings.engram_scope_router_reason_unrecognised,
        )

    def _apply_scope_decision(
        self,
        grounded: GroundedPools,
        decision: ScopeDecision,
    ) -> GroundedPools:
        """Drop at most one labelled list. Never add, never skip may_ground."""
        settings = self._settings
        persona = grounded.persona_memories
        caller = grounded.caller_memories
        used = [
            dict(row) if isinstance(row, dict) else row
            for row in grounded.outcome.memories_used
        ]
        pool_key = settings.memory_ref_pool_key
        if decision.scope == settings.engram_retrieve_scope_shared:
            caller = []
            used = [
                row
                for row in used
                if isinstance(row, dict)
                and row.get(pool_key) == settings.memory_ref_pool_persona
            ]
        elif decision.scope == settings.engram_retrieve_scope_private:
            persona = []
            used = [
                row
                for row in used
                if isinstance(row, dict)
                and row.get(pool_key) == settings.memory_ref_pool_caller
            ]
        memories = [*persona, *caller]
        outcome = ChatOutcome(
            messages=memories,
            text=settings.engram_message_join.join(memories),
            memories_used=used,
            session_id=grounded.outcome.session_id,
            raw=grounded.outcome.raw,
            brain_ms=grounded.outcome.brain_ms,
        )
        return GroundedPools(
            persona_memories=persona,
            caller_memories=caller,
            outcome=outcome,
            shared_hits=grounded.shared_hits,
            shared_grounded=grounded.shared_grounded,
            shared_dropped=grounded.shared_dropped,
            private_hits=grounded.private_hits,
            private_grounded=grounded.private_grounded,
            private_dropped=grounded.private_dropped,
        )

    def _decision_after_scope(
        self,
        decision: Decision,
        scope: str,
    ) -> Decision:
        """A narrowed-to-empty list still speaks; it never borrows the other pool."""
        if decision.action is Action.SPEAK:
            return decision
        if ReasonCode.EMPTY_REPLY not in decision.reasons:
            return decision
        if scope == self._settings.engram_retrieve_scope_both:
            return decision
        return Decision(
            Action.SPEAK,
            (ReasonCode.EMPTY_CHOSEN_POOL,),
            decision.hints,
        )

    def _retrieve_grounded(
        self,
        brain: PersonaBrain,
        *,
        member_authenticated: bool,
        app_user_id: UUID,
        engram_user_id: str,
        email: str,
        engram_persona_id: str,
        query: str,
        prior_sid: str | None,
    ) -> tuple[GroundedPools, ScopeDecision, bool]:
        started_router = time.perf_counter()
        scope_fut = self._start_scope_router(
            query,
            member_authenticated=member_authenticated,
        )
        started_read = time.perf_counter()
        try:
            shared, private, member_authenticated = self._fetch_scoped_retrieves(
                brain,
                member_authenticated=member_authenticated,
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                email=email,
                engram_persona_id=engram_persona_id,
                query=query,
            )
        except BaseException:
            if scope_fut is not None:
                _drain(scope_fut)
            raise
        grounded = self._ground_retrieve(
            shared,
            private,
            engram_user_id=engram_user_id,
            prior_sid=prior_sid,
            brain_ms=int((time.perf_counter() - started_read) * 1000),
            member_authenticated=member_authenticated,
        )
        scope_decision = self._await_scope_decision(
            scope_fut,
            started=started_router,
            member_authenticated=member_authenticated,
        )
        return (
            self._apply_scope_decision(grounded, scope_decision),
            scope_decision,
            member_authenticated,
        )

    def _fetch_scoped_retrieves(
        self,
        brain: PersonaBrain,
        *,
        member_authenticated: bool,
        app_user_id: UUID,
        engram_user_id: str,
        email: str,
        engram_persona_id: str,
        query: str,
    ) -> tuple[RetrieveOutcome, RetrieveOutcome, bool]:
        """Shared and private reads. Private never runs on the org key."""
        shared_scope = self._settings.engram_retrieve_scope_shared
        private_scope = self._settings.engram_retrieve_scope_private
        shared_k = self._settings.engram_retrieve_top_k_shared
        private_k = self._settings.engram_retrieve_top_k_private

        def shared_on(active: PersonaBrain) -> RetrieveOutcome:
            return active.retrieve_scoped(
                engram_persona_id,
                query,
                scope=shared_scope,
                top_k=shared_k,
            )

        def private_on(active: PersonaBrain) -> RetrieveOutcome:
            return active.retrieve_scoped(
                engram_persona_id,
                query,
                scope=private_scope,
                top_k=private_k,
            )

        if not member_authenticated:
            return shared_on(brain), _empty_retrieve(), False

        # Only the private leg is submitted; the shared leg runs on the
        # calling thread. One pool slot per turn, and the shared read can
        # never queue behind anything.
        private_fut = self._readers.submit(
            lambda: self._run_member_op(
                brain,
                member_authenticated=True,
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                email=email,
                op=private_on,
            ),
        )
        try:
            shared = self._run_member_op(
                brain,
                member_authenticated=True,
                app_user_id=app_user_id,
                engram_user_id=engram_user_id,
                email=email,
                op=shared_on,
            )
        except BaseException:
            # Consume the private leg so its failure cannot mask this one.
            _drain(private_fut)
            raise
        private = private_fut.result()
        if shared is None:
            org = self._brains.get(engram_user_id)
            return shared_on(org), _empty_retrieve(), False
        if private is None:
            return shared, _empty_retrieve(), True
        return shared, private, True

    def _ground_pool(
        self,
        found: RetrieveOutcome,
        *,
        engram_user_id: str,
        member_authenticated: bool,
        require_shared: bool,
        require_own_private: bool,
    ) -> tuple[list[Any], list[str], int, int, int]:
        kept: list[Any] = []
        for hit in found.results:
            if not may_ground(
                hit.tenant,
                engram_user_id=engram_user_id,
                member_authenticated=member_authenticated,
            ):
                continue
            if require_shared and not is_shared_pool(hit.tenant):
                continue
            if require_own_private and not is_own_private_pool(
                hit.tenant,
                engram_user_id=engram_user_id,
            ):
                continue
            kept.append(hit)
        texts = [
            hit.text.strip()
            for hit in kept
            if isinstance(hit.text, str) and hit.text.strip()
        ]
        hits = len(found.results)
        grounded = len(kept)
        return kept, texts, hits, grounded, hits - grounded

    def _ground_retrieve(
        self,
        shared: RetrieveOutcome,
        private: RetrieveOutcome,
        *,
        engram_user_id: str,
        prior_sid: str | None,
        brain_ms: int,
        member_authenticated: bool,
    ) -> GroundedPools:
        """Keep only retrieve rows this member is allowed to hear.

        `memories` and `memories_used` are built from the same filtered lists so
        a dropped row cannot still be persisted and re-served. `may_ground`
        is applied to every row of both pools.
        """
        shared_kept, persona_memories, shared_hits, shared_kept_n, shared_dropped = (
            self._ground_pool(
                shared,
                engram_user_id=engram_user_id,
                member_authenticated=member_authenticated,
                require_shared=True,
                require_own_private=False,
            )
        )
        private_kept, caller_memories, private_hits, private_kept_n, private_dropped = (
            self._ground_pool(
                private,
                engram_user_id=engram_user_id,
                member_authenticated=member_authenticated,
                require_shared=False,
                require_own_private=True,
            )
        )
        memories = [*persona_memories, *caller_memories]
        used = [
            self._memory_ref(hit, self._settings.memory_ref_pool_persona)
            for hit in shared_kept
        ] + [
            self._memory_ref(hit, self._settings.memory_ref_pool_caller)
            for hit in private_kept
        ]
        log.info(
            self._settings.log_retrieve_grounded_event,
            retrieve_hits=shared_hits + private_hits,
            retrieve_hits_grounded=shared_kept_n + private_kept_n,
            retrieve_hits_dropped=shared_dropped + private_dropped,
            retrieve_hits_shared=shared_hits,
            retrieve_hits_shared_grounded=shared_kept_n,
            retrieve_hits_shared_dropped=shared_dropped,
            retrieve_hits_private=private_hits,
            retrieve_hits_private_grounded=private_kept_n,
            retrieve_hits_private_dropped=private_dropped,
        )
        outcome = ChatOutcome(
            messages=memories,
            text=self._settings.engram_message_join.join(memories),
            memories_used=used,
            session_id=prior_sid,
            raw={"shared": shared.raw, "private": private.raw},
            brain_ms=brain_ms,
        )
        return GroundedPools(
            persona_memories=persona_memories,
            caller_memories=caller_memories,
            outcome=outcome,
            shared_hits=shared_hits,
            shared_grounded=shared_kept_n,
            shared_dropped=shared_dropped,
            private_hits=private_hits,
            private_grounded=private_kept_n,
            private_dropped=private_dropped,
        )

    def _memory_ref(self, hit: RetrieveHit, pool: str) -> dict[str, Any]:
        raw = dict(hit.raw) if isinstance(hit.raw, dict) else {"value": hit.raw}
        raw[self._settings.memory_ref_pool_key] = pool
        return raw

    def retrieve_memories(
        self,
        *,
        app_user_id: UUID,
        engram_user_id: str,
        engram_persona_id: str,
    ) -> list[dict[str, str | None]]:
        bound = self._bound_engram_user_id(app_user_id, engram_user_id)
        email = ""
        try:
            with borrow(self._settings) as conn:
                loaded = user_email(conn, app_user_id)
            email = loaded or ""
        except Exception:
            email = ""
        brain, authenticated, _credential = self._resolve_member_client(
            app_user_id=app_user_id,
            engram_user_id=bound,
            email=email,
        )
        # A private read on the org key is the original leak. Degraded
        # members get an empty panel rather than the key owner's pool.
        if not authenticated:
            return []
        private_scope = self._settings.engram_retrieve_scope_private
        outcome = self._run_member_op(
            brain,
            member_authenticated=True,
            app_user_id=app_user_id,
            engram_user_id=bound,
            email=email,
            op=lambda active: active.retrieve_scoped(
                engram_persona_id,
                self._settings.memory_panel_query,
                scope=private_scope,
                top_k=self._settings.memory_panel_top_k,
            ),
        )
        if outcome is None:
            return []
        # This panel is what the persona remembers about *this* member.
        # The request already named the private scope; `may_ground` and
        # `is_own_private_pool` stay as defence in depth.
        memories: list[dict[str, str | None]] = []
        for hit in outcome.results:
            if not hit.text:
                continue
            if not may_ground(
                hit.tenant,
                engram_user_id=bound,
                member_authenticated=authenticated,
            ):
                continue
            if not is_own_private_pool(hit.tenant, engram_user_id=bound):
                continue
            memories.append({"text": hit.text, "tenant": hit.tenant})
        return memories

    def _bound_engram_user_id(self, app_user_id: UUID, claimed: str) -> str:
        """Refuse a caller whose stored Engram id does not match the header.

        The turn path already checks this inline in `_begin`; the memory panel
        needs the same gate so a valid internal secret alone can never read
        another user's private pool. After join, bind the stored People id
        even if the header is still the admit placeholder.
        """
        try:
            with borrow(self._settings) as conn:
                stored = user_engram_id(conn, app_user_id)
        except Exception as exc:
            raise TurnError(
                self._settings.failure_message_database,
                status=503,
                reason="database_unavailable",
                code=self._settings.failure_code_database,
            ) from exc
        if stored_engram_matches(stored, claimed) and stored:
            return persona_engine_user_id(stored)
        if stored and claimed_is_admit_placeholder(
            app_user_id=app_user_id,
            claimed=claimed,
        ):
            return persona_engine_user_id(stored)
        raise TurnError(
            "forbidden",
            status=403,
            reason="identity_mismatch",
        )

    def forget_member_session(self, engram_user_id: str) -> None:
        """Drop a cached session JWT so delete-my-data cannot keep talking as them."""
        self._sessions.drop(engram_user_id)
        self._member_brains.forget(engram_user_id)

    def forget_grant_attempts(
        self,
        *,
        app_user_id: UUID,
        persona_id: UUID | None = None,
    ) -> None:
        """Drop cached subscribe attempts after delete-my-data.

        Called even when Engram forget/unsubscribe is partial, so a member who
        talks again is not stuck on a stale (user, persona) pair until restart.
        """
        user_key = str(app_user_id)
        if persona_id is None:
            self._grant_tried = {
                pair for pair in self._grant_tried if pair[0] != user_key
            }
            return
        self._grant_tried.discard((user_key, str(persona_id)))

    def forget_grant_attempts_all(self) -> None:
        self._grant_tried.clear()

    def close(self) -> None:
        self._writers.shutdown(wait=True)
        self._readers.shutdown(wait=True)
        self._routers.shutdown(wait=True)
        self._brains.close()
        self._member_brains.close()

    def _persist(
        self,
        conn: Any,
        *,
        session_id: UUID,
        user_text: str,
        decision: Decision,
        spoken: str | None,
        outcome: ChatOutcome | None,
        engram_session_id: str | None,
        brain_ms: int | None,
        reframe_ms: int | None,
        reframe_first_token_ms: int | None,
        total_ms: int,
        mode: str,
        correlation_id: UUID,
        retrieve_scope: str | None = None,
        retrieve_scope_reason: str | None = None,
    ) -> list[UUID]:
        if not claim_write_receipt(conn, session_id, correlation_id):
            return load_receipt_turn_ids(conn, session_id, correlation_id)
        reasons = [reason.value for reason in decision.reasons]
        if retrieve_scope:
            reasons.append(retrieve_scope)
        if retrieve_scope_reason:
            reasons.append(retrieve_scope_reason)
        user_ordinal = next_ordinal(conn, session_id)
        user_turn_id = insert_turn(
            conn,
            session_id=session_id,
            ordinal=user_ordinal,
            speaker=TURN_SPEAKER_USER,
            text=user_text,
            controller_action=decision.action.value,
            controller_reasons=reasons,
            brain_mode=mode,
            correlation_id=correlation_id,
        )
        ids = [user_turn_id]
        span_turn = user_turn_id
        if spoken is not None and outcome is not None:
            persona_turn_id = insert_turn(
                conn,
                session_id=session_id,
                ordinal=user_ordinal + 1,
                speaker=TURN_SPEAKER_PERSONA,
                text=spoken,
                messages=outcome.messages,
                controller_action=decision.action.value,
                controller_reasons=reasons,
                brain_mode=mode,
                correlation_id=correlation_id,
            )
            ids.append(persona_turn_id)
            span_turn = persona_turn_id
            if engram_session_id:
                insert_memory_refs(
                    conn,
                    turn_id=persona_turn_id,
                    memories_used=list(outcome.memories_used),
                    engram_session_id=engram_session_id,
                )
        insert_latency_spans(
            conn,
            turn_id=span_turn,
            brain_ms=brain_ms,
            reframe_ms=reframe_ms,
            reframe_first_token_ms=reframe_first_token_ms,
            total_ms=total_ms,
        )
        store_receipt_turn_ids(
            conn,
            session_id,
            correlation_id,
            user_turn_id,
            ids[1] if len(ids) > 1 else None,
        )
        return ids
