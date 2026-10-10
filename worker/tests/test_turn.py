from threading import Barrier, Event
from time import perf_counter
from uuid import uuid4

import pytest

from worker.config import WorkerSettings
from worker.controller.decision import Action, Decision, ReasonCode
from worker.engram.caller_facts import (
    CallerFactExtract,
    CallerFactExtractor,
    stamp_caller_fact,
)
from worker.engram.errors import BrainError
from worker.engram.interface import RetrieveHit, RetrieveOutcome
from worker.engram.scope_router import ScopeDecision
from worker.observe.fields import turn_log_fields
from worker.reframe.types import HistoryTurn
from worker.turn.service import TurnPlan, TurnRunner, _persona_identity

ORG = "100912164da2419885314c9fdb5358b7"
PERSONA = "3a07018eb5c2483ab80f07e90488b5f4"
MEMBER = "07b2b9f777c9446b86c5d593a374cc80"
OTHER = "8de1b2b278724e0bba19000086f8bef2"

SHARED = f"{ORG}:{PERSONA}"
OWN_PRIVATE = f"{ORG}:{PERSONA}:{MEMBER}"
OTHER_PRIVATE = f"{ORG}:{PERSONA}:{OTHER}"


def _mixed_hits() -> tuple[RetrieveHit, RetrieveHit, RetrieveHit]:
    shared = RetrieveHit(
        tenant=SHARED,
        text="Ada was taught this",
        raw={"tenant": SHARED, "text": "Ada was taught this", "gid": 1001},
    )
    own = RetrieveHit(
        tenant=OWN_PRIVATE,
        text="I told Ada my colour",
        raw={"tenant": OWN_PRIVATE, "text": "I told Ada my colour", "gid": 1002},
    )
    other = RetrieveHit(
        tenant=OTHER_PRIVATE,
        text="my name is Harish",
        raw={"tenant": OTHER_PRIVATE, "text": "my name is Harish", "gid": 1003},
    )
    return shared, own, other


def _pooled(
    hit: RetrieveHit,
    pool: str,
    settings: WorkerSettings,
) -> dict:
    raw = dict(hit.raw)
    raw[settings.memory_ref_pool_key] = pool
    return raw


def test_retrieve_grounds_shared_and_own_private_when_member_authenticates(
    settings: WorkerSettings,
) -> None:
    shared, own, other = _mixed_hits()
    runner = TurnRunner(
        settings.model_copy(update={"engram_member_session_auth": True}),
    )
    try:
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[shared], raw={"ok": True}),
            RetrieveOutcome(results=[own, other], raw={"ok": True}),
            engram_user_id=MEMBER,
            prior_sid="sess-1",
            brain_ms=12,
            member_authenticated=True,
        )
        assert grounded.memories == [shared.text, own.text]
        assert grounded.outcome.messages == [shared.text, own.text]
        assert grounded.outcome.memories_used == [
            _pooled(shared, settings.memory_ref_pool_persona, settings),
            _pooled(own, settings.memory_ref_pool_caller, settings),
        ]
        assert other.raw not in grounded.outcome.memories_used
        assert grounded.hits == 3
        assert grounded.grounded == 2
        assert grounded.dropped == 1
        assert grounded.shared_hits == 1
        assert grounded.shared_grounded == 1
        assert grounded.shared_dropped == 0
        assert grounded.private_hits == 2
        assert grounded.private_grounded == 1
        assert grounded.private_dropped == 1
    finally:
        runner.close()


def test_retrieve_grounds_shared_only_without_member_auth(
    settings: WorkerSettings,
) -> None:
    # On one org key the "own" private pool is the key owner's, and it holds
    # every member's turns. Nobody grounds on it — not even its owner.
    shared, own, other = _mixed_hits()
    runner = TurnRunner(settings)
    try:
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[shared], raw={"ok": True}),
            RetrieveOutcome(results=[own, other], raw={"ok": True}),
            engram_user_id=MEMBER,
            prior_sid="sess-1",
            brain_ms=12,
            member_authenticated=False,
        )
        assert grounded.memories == [shared.text]
        assert grounded.outcome.memories_used == [
            _pooled(shared, settings.memory_ref_pool_persona, settings),
        ]
        assert grounded.hits == 3
        assert grounded.grounded == 1
        assert grounded.dropped == 2
        assert grounded.private_grounded == 0
    finally:
        runner.close()


def test_key_owner_is_not_handed_the_shared_admin_pool(
    settings: WorkerSettings,
) -> None:
    # The API key owner signing in maps to the admin People id, so the mixed
    # pool would look like their own memory. It must still be refused.
    shared, _own, other = _mixed_hits()
    runner = TurnRunner(settings)
    try:
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[shared], raw={"ok": True}),
            RetrieveOutcome(results=[other], raw={"ok": True}),
            engram_user_id=OTHER,
            prior_sid="sess-1",
            brain_ms=12,
            member_authenticated=False,
        )
        assert grounded.memories == [shared.text]
        assert other.raw not in grounded.outcome.memories_used
        assert grounded.hits == 2
        assert grounded.grounded == 1
        assert grounded.dropped == 1
    finally:
        runner.close()


def test_retrieve_drops_missing_tenant_from_memories_used(
    settings: WorkerSettings,
) -> None:
    runner = TurnRunner(settings)
    blank = RetrieveHit(
        tenant=None,
        text="ungrounded",
        raw={"text": "ungrounded"},
    )
    try:
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[blank], raw={}),
            RetrieveOutcome(results=[], raw={}),
            engram_user_id=MEMBER,
            prior_sid=None,
            brain_ms=1,
            member_authenticated=False,
        )
        assert grounded.memories == []
        assert grounded.outcome.messages == []
        assert grounded.outcome.memories_used == []
        assert grounded.hits == 1
        assert grounded.grounded == 0
        assert grounded.dropped == 1
    finally:
        runner.close()


def test_retrieve_counts_are_allowlisted_and_text_is_not(
    settings: WorkerSettings,
) -> None:
    fields = turn_log_fields(
        settings,
        {
            "correlation_id": "c",
            "session_id": "s",
            "retrieve_hits": 25,
            "retrieve_hits_grounded": 0,
            "retrieve_hits_dropped": 25,
            "retrieve_hits_shared": 10,
            "retrieve_hits_shared_grounded": 0,
            "retrieve_hits_shared_dropped": 10,
            "retrieve_hits_private": 15,
            "retrieve_hits_private_grounded": 0,
            "retrieve_hits_private_dropped": 15,
            "member_authenticated": False,
            "engram_credential": "org",
            "retrieve_scope": "both",
            "retrieve_scope_reason": "disabled",
            "text": "should never be logged",
        },
    )
    assert fields["retrieve_hits"] == 25
    assert fields["retrieve_hits_grounded"] == 0
    assert fields["retrieve_hits_dropped"] == 25
    assert fields["retrieve_hits_shared"] == 10
    assert fields["retrieve_hits_private"] == 15
    assert fields["member_authenticated"] is False
    assert fields["engram_credential"] == "org"
    assert fields["retrieve_scope"] == "both"
    assert fields["retrieve_scope_reason"] == "disabled"
    assert "text" not in fields


def test_retrieve_memories_panel_keeps_own_private_only(
    settings: WorkerSettings,
) -> None:
    shared, own, other = _mixed_hits()
    scopes: list[str] = []

    class _Brain:
        def retrieve_scoped(
            self,
            persona_id: str,
            query: str,
            *,
            scope: str,
            top_k: int,
        ):
            scopes.append(scope)
            return RetrieveOutcome(
                results=[shared, own, other],
                raw={"ok": True},
            )

    class _Brains:
        def get(self, engram_user_id: str) -> _Brain:
            return _Brain()

        def close(self) -> None:
            return None

    def _panel(authenticated: bool) -> list[dict[str, str | None]]:
        loaded = settings.model_copy(
            update={"engram_member_session_auth": authenticated},
        )
        runner = TurnRunner(loaded)
        runner._brains = _Brains()  # type: ignore[assignment]
        runner._bound_engram_user_id = (  # type: ignore[method-assign]
            lambda app_user_id, claimed: MEMBER
        )
        fake = runner._brains.get(MEMBER)
        runner._resolve_member_client = (  # type: ignore[method-assign]
            lambda **kwargs: (
                fake,
                authenticated,
                loaded.engram_credential_member
                if authenticated
                else loaded.engram_credential_org,
            )
        )
        runner._run_member_op = (  # type: ignore[method-assign]
            lambda brain, op, **kwargs: op(brain) if brain is not None else None
        )
        try:
            return runner.retrieve_memories(
                app_user_id=uuid4(),
                engram_user_id=MEMBER,
                engram_persona_id=PERSONA,
            )
        finally:
            runner.close()

    scopes.clear()
    assert _panel(True) == [{"text": own.text, "tenant": OWN_PRIVATE}]
    assert scopes == [settings.engram_retrieve_scope_private]
    # Without member session auth a private row is the shared admin pool, so
    # the panel shows nothing rather than someone else's memory — and never
    # issues a private read on the org key.
    scopes.clear()
    assert _panel(False) == []
    assert scopes == []


def _retrieve_plan() -> TurnPlan:
    return TurnPlan(
        session_id=uuid4(),
        text="hello",
        started=0.0,
        decision=Decision(
            action=Action.SPEAK,
            reasons=(ReasonCode.HAS_GROUNDED_REPLY,),
            hints={},
        ),
        prior_sid="sess-1",
        persona_identity={},
        voice_config={},
        history=[],
        correlation_id=uuid4(),
        mode="retrieve",
        engram_user_id=MEMBER,
        engram_persona_id=PERSONA,
    )


def test_write_back_suppressed_while_member_session_auth_is_false(
    settings: WorkerSettings,
) -> None:
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = False
    runner = TurnRunner(settings)
    try:
        assert runner._should_write_back(_retrieve_plan()) is False
    finally:
        runner.close()


def test_write_back_follows_plan_not_global_flag(
    settings: WorkerSettings,
) -> None:
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    plan = _retrieve_plan()
    try:
        assert runner._should_write_back(plan) is False
        plan.member_authenticated = True
        assert runner._should_write_back(plan) is True
    finally:
        runner.close()


def test_forget_grant_attempts_drops_the_cached_pair(
    settings: WorkerSettings,
) -> None:
    runner = TurnRunner(settings)
    user = uuid4()
    persona = uuid4()
    other = uuid4()
    runner._grant_tried.add((str(user), str(persona)))
    runner._grant_tried.add((str(other), str(persona)))
    try:
        runner.forget_grant_attempts(app_user_id=user, persona_id=persona)
        assert (str(user), str(persona)) not in runner._grant_tried
        assert (str(other), str(persona)) in runner._grant_tried
        runner.forget_grant_attempts(app_user_id=other)
        assert runner._grant_tried == set()
    finally:
        runner.close()


class _KindBrain:
    def __init__(self, kind: str) -> None:
        self.kind = kind
        self.retrieves = 0
        self.chats = 0
        self.converses = 0
        self.private_texts = 0

    def retrieve(self, persona_id: str, query: str, *, top_k: int = 10):
        self.retrieves += 1
        return RetrieveOutcome(results=[], raw={})

    def retrieve_scoped(
        self,
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ):
        self.retrieves += 1
        return RetrieveOutcome(results=[], raw={"scope": scope})

    def chat(self, persona_id: str, message: str, session_id: str | None = None):
        self.chats += 1
        return None

    def converse(self, *args: object, **kwargs: object) -> dict[str, bool]:
        self.converses += 1
        return {"ok": True}

    def ingest_private_text(self, *args: object, **kwargs: object) -> dict[str, bool]:
        self.private_texts += 1
        return {"ok": True}

    def close(self) -> None:
        return None


class _KindRegistry:
    def __init__(self, kind: str) -> None:
        self.kind = kind
        self.brain = _KindBrain(kind)
        self.api_keys: list[str | None] = []

    def get(self, engram_user_id: str, *, api_key: str | None = None) -> _KindBrain:
        self.api_keys.append(api_key)
        return self.brain

    def forget(self, engram_user_id: str) -> None:
        return None

    def close(self) -> None:
        return None


def test_flag_off_resolves_org_even_when_a_password_exists(
    settings: WorkerSettings,
) -> None:
    runner = TurnRunner(settings)
    org = _KindRegistry("org")
    runner._brains = org  # type: ignore[assignment]
    runner._load_member_password = lambda _uid: "pw"  # type: ignore[method-assign]
    try:
        brain, authenticated, credential = runner._resolve_member_client(
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
        )
        assert authenticated is False
        assert credential == settings.engram_credential_org
        assert brain.kind == "org"
        assert runner._conversation_mode(False) == "retrieve"
        plan = _retrieve_plan()
        plan.member_authenticated = False
        assert runner._should_write_back(plan) is False
    finally:
        runner.close()


def test_flag_on_with_member_client_grounds_and_writes(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    member = _KindBrain("member")
    runner._resolve_member_client = (  # type: ignore[method-assign]
        lambda **kwargs: (member, True, loaded.engram_credential_member)
    )
    shared, own, other = _mixed_hits()
    try:
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[shared], raw={}),
            RetrieveOutcome(results=[own, other], raw={}),
            engram_user_id=MEMBER,
            prior_sid=None,
            brain_ms=1,
            member_authenticated=True,
        )
        assert own.text in grounded.memories
        assert other.text not in grounded.memories
        assert grounded.hits == 3
        assert grounded.grounded == 2
        assert grounded.dropped == 1
        assert runner._conversation_mode(True) == "retrieve"
        chatty = TurnRunner(
            loaded.model_copy(update={"brain_mode": "chat"}),
        )
        try:
            assert chatty._conversation_mode(True) == "chat"
            assert chatty._conversation_mode(False) == "retrieve"
        finally:
            chatty.close()
        plan = _retrieve_plan()
        plan.member_authenticated = True
        loaded.engram_converse_writeback = True
        assert runner._should_write_back(plan) is True
    finally:
        runner.close()


def test_flag_on_null_secret_degrades_to_shared_retrieve(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(
        update={"engram_member_session_auth": True, "brain_mode": "chat"},
    )
    runner = TurnRunner(loaded)
    org = _KindRegistry("org")
    runner._brains = org  # type: ignore[assignment]
    runner._load_member_password = lambda _uid: None  # type: ignore[method-assign]
    try:
        brain, authenticated, credential = runner._resolve_member_client(
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
        )
        assert authenticated is False
        assert credential == loaded.engram_credential_org
        assert brain.kind == "org"
        assert runner._conversation_mode(False) == "retrieve"
        shared, own, other = _mixed_hits()
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[shared], raw={}),
            RetrieveOutcome(results=[own, other], raw={}),
            engram_user_id=MEMBER,
            prior_sid=None,
            brain_ms=1,
            member_authenticated=False,
        )
        assert grounded.memories == [shared.text]
        plan = _retrieve_plan()
        plan.member_authenticated = False
        assert runner._should_write_back(plan) is False
    finally:
        runner.close()


def test_flag_on_login_failure_is_unauthenticated_org(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    org = _KindRegistry("org")
    runner._brains = org  # type: ignore[assignment]
    runner._load_member_password = lambda _uid: "pw"  # type: ignore[method-assign]
    runner._sessions.token = (  # type: ignore[method-assign]
        lambda **kwargs: None
    )
    try:
        brain, authenticated, credential = runner._resolve_member_client(
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
        )
        assert authenticated is False
        assert credential == loaded.engram_credential_org
        assert brain.kind == "org"
        assert runner._conversation_mode(False) == "retrieve"
        plan = _retrieve_plan()
        plan.member_authenticated = False
        assert runner._should_write_back(plan) is False
    finally:
        runner.close()


def test_authenticated_op_uses_member_token_not_org(
    settings: WorkerSettings,
) -> None:
    from worker.engram.session import MemberSessionCache

    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    org = _KindRegistry("org")
    member = _KindRegistry("member")
    runner._brains = org  # type: ignore[assignment]
    runner._member_brains = member  # type: ignore[assignment]
    runner._load_member_password = lambda _uid: "pw"  # type: ignore[method-assign]
    runner._sessions = MemberSessionCache(
        loaded,
        login=lambda _email, _password: {
            "token": "jwt-member",
            "expires_in": 43200,
        },
    )
    try:
        brain, authenticated, credential = runner._resolve_member_client(
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
        )
        assert authenticated is True
        assert credential == loaded.engram_credential_member
        assert brain.kind == "member"
        used: list[str] = []
        result = runner._run_member_op(
            brain,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            op=lambda active: used.append(active.kind) or active.kind,
        )
        assert result == "member"
        assert used == ["member"]
        assert "jwt-member" in member.api_keys
    finally:
        runner.close()


def test_forget_member_session_drops_cached_token(
    settings: WorkerSettings,
) -> None:
    from worker.engram.session import MemberSessionCache

    runner = TurnRunner(settings)
    logins = {"n": 0}

    def login(_email: str, _password: str) -> dict[str, object]:
        logins["n"] += 1
        return {"token": f"tok-{logins['n']}", "expires_in": 43200}

    runner._sessions = MemberSessionCache(settings, login=login)
    try:
        first = runner._sessions.token(
            engram_user_id=MEMBER,
            email="a@example.com",
            password_provider=lambda: "pw",
        )
        assert first == "tok-1"
        runner.forget_member_session(MEMBER)
        second = runner._sessions.token(
            engram_user_id=MEMBER,
            email="a@example.com",
            password_provider=lambda: "pw",
        )
        assert second == "tok-2"
        assert logins["n"] == 2
    finally:
        runner.close()


def _stub_writeback_db(monkeypatch, *, claimed: bool = True) -> None:
    from worker.turn import service as turn_mod

    class _Conn:
        def commit(self) -> None:
            return None

    class _Borrow:
        def __enter__(self) -> _Conn:
            return _Conn()

        def __exit__(self, *args: object) -> bool:
            return False

    monkeypatch.setattr(turn_mod, "claim_writeback", lambda *_a, **_k: claimed)
    monkeypatch.setattr(turn_mod, "borrow", lambda _s: _Borrow())
    monkeypatch.setattr(turn_mod, "user_email", lambda *_a, **_k: "a@example.com")


class _Extract:
    def __init__(self, result: CallerFactExtract) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def extract(
        self,
        *,
        history: list[HistoryTurn],
        user_turn: str,
        persona_reply: str,
    ) -> CallerFactExtract:
        self.calls.append(
            {
                "history": history,
                "user_turn": user_turn,
                "persona_reply": persona_reply,
            }
        )
        return self.result


def test_degraded_write_back_never_converses(
    settings: WorkerSettings,
) -> None:
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("converse") or {"ok": True}
    )
    plan = _retrieve_plan()
    plan.member_authenticated = False
    plan.spoken = "hi"
    plan.app_user_id = uuid4()
    try:
        runner._write_back(plan)
        assert called == []
    finally:
        runner.close()


@pytest.mark.parametrize(
    ("user_turn", "persona_reply", "facts"),
    [
        ("hi", "hello", []),
        ("I live in Pune", "good to know", ["The caller lives in Pune."]),
        ("are you working at Metacognition?", "yes", []),
        ("tell me about yourself", "I work at Metacognition", []),
    ],
)
def test_write_back_mocked_extract_writes_private_text_not_converse(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
    user_turn: str,
    persona_reply: str,
    facts: list[str],
) -> None:
    _stub_writeback_db(monkeypatch)
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    reason = (
        settings.caller_fact_reason_extracted
        if facts
        else settings.caller_fact_reason_empty
    )
    extractor = _Extract(CallerFactExtract(facts, reason))
    runner._extractor = extractor  # type: ignore[assignment]
    ingested: list[str] = []
    conversed: list[str] = []
    shared: list[str] = []

    class _Active:
        def ingest_private_text(self, persona_id: str, text: str) -> dict[str, bool]:
            ingested.append(text)
            assert persona_id == PERSONA
            return {"ok": True}

        def ingest_shared_text(
            self,
            *args: object,
            **kwargs: object,
        ) -> dict[str, bool]:
            shared.append("shared")
            return {"ok": True}

        def converse(self, *args: object, **kwargs: object) -> dict[str, bool]:
            conversed.append("converse")
            return {"ok": True}

    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: k["op"](_Active())
    )
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.text = user_turn
    plan.spoken = persona_reply
    plan.app_user_id = uuid4()
    try:
        runner._write_back(plan)
        assert ingested == [stamp_caller_fact(fact, settings) for fact in facts]
        assert conversed == []
        assert shared == []
        assert extractor.calls[0]["user_turn"] == user_turn
        assert extractor.calls[0]["persona_reply"] == persona_reply
        assert runner._should_write_back(plan) is True
    finally:
        runner.close()


def test_write_back_extract_error_writes_nothing(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_writeback_db(monkeypatch)
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        CallerFactExtract([], settings.caller_fact_reason_timeout),
    )
    runner._extractor = extractor  # type: ignore[assignment]
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("write") or {"ok": True}
    )
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.spoken = "I work at Metacognition"
    plan.text = "hello"
    plan.app_user_id = uuid4()
    try:
        runner._write_back(plan)
        assert called == []
    finally:
        runner.close()


def test_write_back_missing_client_writes_nothing(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_writeback_db(monkeypatch)
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    runner._extractor = CallerFactExtractor(settings, None)
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("write") or {"ok": True}
    )
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.text = "I live in Pune"
    plan.spoken = "good to know"
    plan.app_user_id = uuid4()
    try:
        runner._write_back(plan)
        assert called == []
    finally:
        runner.close()


def test_write_back_brain_error_does_not_dump_transcript(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_writeback_db(monkeypatch)
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        CallerFactExtract(
            ["The caller lives in Pune."],
            settings.caller_fact_reason_extracted,
        ),
    )
    runner._extractor = extractor  # type: ignore[assignment]
    conversed: list[str] = []

    class _Active:
        def ingest_private_text(
            self,
            *args: object,
            **kwargs: object,
        ) -> dict[str, bool]:
            raise BrainError("ingest failed")

        def converse(self, *args: object, **kwargs: object) -> dict[str, bool]:
            conversed.append("converse")
            return {"ok": True}

    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: k["op"](_Active())
    )
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.text = "I live in Pune"
    plan.spoken = "good to know"
    plan.app_user_id = uuid4()
    try:
        runner._write_back(plan)
        assert conversed == []
    finally:
        runner.close()


def test_write_back_skips_extract_when_receipt_already_claimed(
    settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_writeback_db(monkeypatch, claimed=False)
    settings.engram_converse_writeback = True
    settings.engram_member_session_auth = True
    runner = TurnRunner(settings)
    extractor = _Extract(
        CallerFactExtract(
            ["The caller lives in Pune."],
            settings.caller_fact_reason_extracted,
        ),
    )
    runner._extractor = extractor  # type: ignore[assignment]
    called: list[str] = []
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda *a, **k: called.append("write") or {"ok": True}
    )
    plan = _retrieve_plan()
    plan.member_authenticated = True
    plan.app_user_id = uuid4()
    try:
        runner._write_back(plan)
        assert extractor.calls == []
        assert called == []
    finally:
        runner.close()


class _ScopeBrain:
    def __init__(self) -> None:
        self.scopes: list[str] = []

    def retrieve_scoped(
        self,
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        self.scopes.append(scope)
        return RetrieveOutcome(results=[], raw={"scope": scope})


def test_authenticated_retrieves_run_shared_and_private_together(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    barrier = Barrier(2, timeout=2)
    brain = _ScopeBrain()

    def retrieve_scoped(
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        brain.scopes.append(scope)
        barrier.wait()
        return RetrieveOutcome(results=[], raw={"scope": scope})

    brain.retrieve_scoped = retrieve_scoped  # type: ignore[method-assign]
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda brain, op, **kwargs: op(brain)
    )
    try:
        shared, private, authenticated = runner._fetch_scoped_retrieves(
            brain,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="hello",
        )
        assert authenticated is True
        assert set(brain.scopes) == {
            loaded.engram_retrieve_scope_shared,
            loaded.engram_retrieve_scope_private,
        }
        assert shared.raw["scope"] == loaded.engram_retrieve_scope_shared
        assert private.raw["scope"] == loaded.engram_retrieve_scope_private
    finally:
        runner.close()


def test_persona_identity_comes_from_the_catalog_row(
    settings: WorkerSettings,
) -> None:
    """Engram grounds `chat` on name/description; retrieve must match it."""
    identity = _persona_identity(
        {
            "display_name": "Caleb Friesen ",
            "description": " A Canadian tech journalist and filmmaker",
        },
        settings,
    )
    assert identity == {
        settings.persona_identity_name_key: "Caleb Friesen",
        settings.persona_identity_description_key: (
            "A Canadian tech journalist and filmmaker"
        ),
    }


def test_persona_identity_omits_blank_and_missing_fields(
    settings: WorkerSettings,
) -> None:
    blank = {"display_name": "  ", "description": None}
    assert _persona_identity(blank, settings) == {}
    assert _persona_identity({}, settings) == {}
    assert _persona_identity({"display_name": "Ada"}, settings) == {
        settings.persona_identity_name_key: "Ada",
    }


def test_retrieves_stay_parallel_while_a_write_back_is_in_flight(
    settings: WorkerSettings,
) -> None:
    """Reads must not queue behind `converse` on the path to first word."""
    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    release = Event()
    occupied = Event()

    def _busy() -> None:
        occupied.set()
        release.wait(timeout=5)

    # Saturate the write-back pool, exactly as it is right after a reply.
    for _ in range(loaded.engram_writeback_workers):
        runner._writers.submit(_busy)
    assert occupied.wait(timeout=2)

    barrier = Barrier(2, timeout=2)
    brain = _ScopeBrain()

    def retrieve_scoped(
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        brain.scopes.append(scope)
        barrier.wait()
        return RetrieveOutcome(results=[], raw={"scope": scope})

    brain.retrieve_scoped = retrieve_scoped  # type: ignore[method-assign]
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda brain, op, **kwargs: op(brain)
    )
    try:
        shared, private, authenticated = runner._fetch_scoped_retrieves(
            brain,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="hello",
        )
        assert authenticated is True
        assert set(brain.scopes) == {
            loaded.engram_retrieve_scope_shared,
            loaded.engram_retrieve_scope_private,
        }
        assert shared.raw["scope"] == loaded.engram_retrieve_scope_shared
        assert private.raw["scope"] == loaded.engram_retrieve_scope_private
    finally:
        release.set()
        runner.close()


def test_degraded_member_issues_shared_retrieve_only(
    settings: WorkerSettings,
) -> None:
    runner = TurnRunner(settings)
    brain = _ScopeBrain()
    try:
        shared, private, authenticated = runner._fetch_scoped_retrieves(
            brain,
            member_authenticated=False,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="hello",
        )
        assert authenticated is False
        assert brain.scopes == [settings.engram_retrieve_scope_shared]
        assert private.results == []
        assert shared.raw["scope"] == settings.engram_retrieve_scope_shared
    finally:
        runner.close()


def test_org_key_fallback_never_issues_a_private_read(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    org = _ScopeBrain()

    class _OrgReg:
        def get(
            self,
            engram_user_id: str,
            *,
            api_key: str | None = None,
        ) -> _ScopeBrain:
            return org

        def close(self) -> None:
            return None

    runner._brains = _OrgReg()  # type: ignore[assignment]
    runner._run_member_op = lambda *_a, **_k: None  # type: ignore[method-assign]
    member = _ScopeBrain()
    try:
        shared, private, authenticated = runner._fetch_scoped_retrieves(
            member,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="hello",
        )
        assert authenticated is False
        assert member.scopes == []
        assert org.scopes == [loaded.engram_retrieve_scope_shared]
        assert loaded.engram_retrieve_scope_private not in org.scopes
        assert private.results == []
        assert shared.raw["scope"] == loaded.engram_retrieve_scope_shared
    finally:
        runner.close()


def _router_settings(settings: WorkerSettings) -> WorkerSettings:
    return settings.model_copy(
        update={
            "engram_member_session_auth": True,
            "engram_scope_router_enabled": True,
        },
    )


def test_scope_router_runs_beside_both_retrieves(
    settings: WorkerSettings,
) -> None:
    loaded = _router_settings(settings)
    runner = TurnRunner(loaded)
    barrier = Barrier(3, timeout=2)
    brain = _ScopeBrain()

    class _BesideRouter:
        def __init__(self) -> None:
            self.questions: list[str] = []

        def decide(self, question: str) -> ScopeDecision:
            self.questions.append(question)
            barrier.wait()
            return ScopeDecision(
                loaded.engram_retrieve_scope_both,
                loaded.engram_scope_router_reason_both,
            )

    router = _BesideRouter()

    def retrieve_scoped(
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        brain.scopes.append(scope)
        barrier.wait()
        return RetrieveOutcome(results=[], raw={"scope": scope})

    brain.retrieve_scoped = retrieve_scoped  # type: ignore[method-assign]
    runner._scope_router = router  # type: ignore[assignment]
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda brain, op, **kwargs: op(brain)
    )
    try:
        grounded, decision, authenticated = runner._retrieve_grounded(
            brain,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="hello",
            prior_sid="sess-1",
        )
        assert authenticated is True
        assert set(brain.scopes) == {
            loaded.engram_retrieve_scope_shared,
            loaded.engram_retrieve_scope_private,
        }
        assert decision.scope == loaded.engram_retrieve_scope_both
        assert grounded.persona_memories == []
        assert grounded.caller_memories == []
        assert router.questions == ["hello"]
    finally:
        runner.close()


def test_scope_router_timeout_error_and_unrecognised_fall_open_to_both(
    settings: WorkerSettings,
) -> None:
    loaded = _router_settings(settings)
    runner = TurnRunner(loaded)
    try:
        timed = runner._await_scope_decision(
            runner._routers.submit(lambda: (_ for _ in ()).throw(TimeoutError())),
            started=perf_counter(),
            member_authenticated=True,
        )
        failed = runner._await_scope_decision(
            runner._routers.submit(lambda: (_ for _ in ()).throw(RuntimeError("x"))),
            started=perf_counter(),
            member_authenticated=True,
        )
        unknown = runner._canonical_scope_decision(
            ScopeDecision("nope", "x"),
        )
        disabled = runner._await_scope_decision(
            None,
            started=0.0,
            member_authenticated=True,
        )
        unauth = runner._await_scope_decision(
            None,
            started=0.0,
            member_authenticated=False,
        )
        assert timed.scope == loaded.engram_retrieve_scope_both
        assert timed.reason == loaded.engram_scope_router_reason_timeout
        assert failed.scope == loaded.engram_retrieve_scope_both
        assert failed.reason == loaded.engram_scope_router_reason_error
        assert unknown.scope == loaded.engram_retrieve_scope_both
        assert unknown.reason == loaded.engram_scope_router_reason_unrecognised
        assert disabled.reason == loaded.engram_scope_router_reason_disabled
        assert unauth.reason == loaded.engram_scope_router_reason_unauthenticated
        assert unauth.scope == loaded.engram_retrieve_scope_both
    finally:
        runner.close()


def test_scope_router_wait_timeout_falls_open_without_keyword_rules(
    settings: WorkerSettings,
) -> None:
    loaded = _router_settings(settings).model_copy(
        update={"engram_scope_router_timeout_seconds": 0.05},
    )
    runner = TurnRunner(loaded)
    release = Event()

    def hang() -> ScopeDecision:
        release.wait(timeout=5)
        return ScopeDecision(
            loaded.engram_retrieve_scope_private,
            loaded.engram_scope_router_reason_private,
        )

    try:
        decision = runner._await_scope_decision(
            runner._routers.submit(hang),
            started=0.0,
            member_authenticated=True,
        )
        assert decision.scope == loaded.engram_retrieve_scope_both
        assert decision.reason == loaded.engram_scope_router_reason_timeout
    finally:
        release.set()
        runner.close()


def test_apply_scope_only_drops_a_list_and_never_the_other_pool(
    settings: WorkerSettings,
) -> None:
    shared, own, other = _mixed_hits()
    runner = TurnRunner(_router_settings(settings))
    try:
        grounded = runner._ground_retrieve(
            RetrieveOutcome(results=[shared], raw={}),
            RetrieveOutcome(results=[own, other], raw={}),
            engram_user_id=MEMBER,
            prior_sid="sess-1",
            brain_ms=1,
            member_authenticated=True,
        )
        private = runner._apply_scope_decision(
            grounded,
            ScopeDecision(
                settings.engram_retrieve_scope_private,
                settings.engram_scope_router_reason_private,
            ),
        )
        assert private.persona_memories == []
        assert private.caller_memories == [own.text]
        assert other.text not in private.caller_memories
        assert private.outcome.messages == [own.text]
        assert all(
            row.get(settings.memory_ref_pool_key) == settings.memory_ref_pool_caller
            for row in private.outcome.memories_used
        )
        persona = runner._apply_scope_decision(
            grounded,
            ScopeDecision(
                settings.engram_retrieve_scope_shared,
                settings.engram_scope_router_reason_shared,
            ),
        )
        assert persona.persona_memories == [shared.text]
        assert persona.caller_memories == []
        assert persona.outcome.messages == [shared.text]
        both = runner._apply_scope_decision(
            grounded,
            ScopeDecision(
                settings.engram_retrieve_scope_both,
                settings.engram_scope_router_reason_both,
            ),
        )
        assert both.persona_memories == [shared.text]
        assert both.caller_memories == [own.text]
        empty_private = runner._apply_scope_decision(
            runner._ground_retrieve(
                RetrieveOutcome(results=[shared], raw={}),
                RetrieveOutcome(results=[], raw={}),
                engram_user_id=MEMBER,
                prior_sid="sess-1",
                brain_ms=1,
                member_authenticated=True,
            ),
            ScopeDecision(
                settings.engram_retrieve_scope_private,
                settings.engram_scope_router_reason_private,
            ),
        )
        assert empty_private.persona_memories == []
        assert empty_private.caller_memories == []
        spoken = runner._decision_after_scope(
            Decision(Action.SILENCE, (ReasonCode.EMPTY_REPLY,), {}),
            settings.engram_retrieve_scope_private,
        )
        assert spoken.action is Action.SPEAK
        assert ReasonCode.EMPTY_CHOSEN_POOL in spoken.reasons
        still_silent = runner._decision_after_scope(
            Decision(Action.SILENCE, (ReasonCode.EMPTY_REPLY,), {}),
            settings.engram_retrieve_scope_both,
        )
        assert still_silent.action is Action.SILENCE
    finally:
        runner.close()


def test_disabled_router_does_not_start_and_keeps_both_lists(
    settings: WorkerSettings,
) -> None:
    loaded = settings.model_copy(update={"engram_member_session_auth": True})
    runner = TurnRunner(loaded)
    called: list[str] = []

    class _Router:
        def decide(self, question: str) -> ScopeDecision:
            called.append(question)
            return ScopeDecision(
                loaded.engram_retrieve_scope_private,
                loaded.engram_scope_router_reason_private,
            )

    runner._scope_router = _Router()  # type: ignore[assignment]
    brain = _ScopeBrain()
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda brain, op, **kwargs: op(brain)
    )
    shared, own, _other = _mixed_hits()

    def retrieve_scoped(
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        if scope == loaded.engram_retrieve_scope_shared:
            return RetrieveOutcome(results=[shared], raw={"scope": scope})
        return RetrieveOutcome(results=[own], raw={"scope": scope})

    brain.retrieve_scoped = retrieve_scoped  # type: ignore[method-assign]
    try:
        assert runner._start_scope_router("q", member_authenticated=True) is None
        grounded, decision, _auth = runner._retrieve_grounded(
            brain,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="q",
            prior_sid="sess-1",
        )
        assert called == []
        assert decision.reason == loaded.engram_scope_router_reason_disabled
        assert grounded.persona_memories == [shared.text]
        assert grounded.caller_memories == [own.text]
    finally:
        runner.close()


def test_retrieve_grounded_applies_private_and_does_not_fill_from_shared(
    settings: WorkerSettings,
) -> None:
    loaded = _router_settings(settings)
    runner = TurnRunner(loaded)
    shared, own, other = _mixed_hits()

    class _PrivateRouter:
        def decide(self, question: str) -> ScopeDecision:
            return ScopeDecision(
                loaded.engram_retrieve_scope_private,
                loaded.engram_scope_router_reason_private,
            )

    brain = _ScopeBrain()

    def retrieve_scoped(
        persona_id: str,
        query: str,
        *,
        scope: str,
        top_k: int,
    ) -> RetrieveOutcome:
        if scope == loaded.engram_retrieve_scope_shared:
            return RetrieveOutcome(results=[shared], raw={"scope": scope})
        return RetrieveOutcome(results=[own, other], raw={"scope": scope})

    brain.retrieve_scoped = retrieve_scoped  # type: ignore[method-assign]
    runner._scope_router = _PrivateRouter()  # type: ignore[assignment]
    runner._run_member_op = (  # type: ignore[method-assign]
        lambda brain, op, **kwargs: op(brain)
    )
    try:
        grounded, decision, _auth = runner._retrieve_grounded(
            brain,
            member_authenticated=True,
            app_user_id=uuid4(),
            engram_user_id=MEMBER,
            email="a@example.com",
            engram_persona_id=PERSONA,
            query="what do I do?",
            prior_sid="sess-1",
        )
        assert decision.scope == loaded.engram_retrieve_scope_private
        assert grounded.persona_memories == []
        assert grounded.caller_memories == [own.text]
        assert shared.text not in grounded.outcome.messages
    finally:
        runner.close()

