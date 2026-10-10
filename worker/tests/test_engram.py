import json
from types import SimpleNamespace

import httpx
import pytest
from engram_sdk.errors import ForbiddenError as SdkForbiddenError
from engram_sdk.errors import ServerError as SdkServerError
from engram_sdk.errors import UnauthorizedError as SdkUnauthorizedError
from engram_sdk.models import Persona, PersonaReply

from worker.config import WorkerSettings
from worker.engram import errors as app
from worker.engram.engram_brain import EngramBrain, _map_sdk_error
from worker.engram.tenant import private_pool_owner


def _persona() -> Persona:
    return Persona(
        id="p1",
        org_id="org",
        name="Ada",
        handle="ada",
        description="desc",
        avatar_url="",
        status="active",
        tenant="org:ada",
        created_at=None,
        raw={"ok": True},
    )


class FakePersonas:
    def __init__(self) -> None:
        self.retrieves: list[tuple[str, str, int]] = []
        self.converses: list[dict[str, object]] = []
        self.private_calls: list[tuple[str, str | None]] = []
        self.private_texts: list[str] = []
        self.retrieve_errors: list[Exception] = []
        self.chat_error: Exception | None = None
        self.subscribed: list[tuple[str, str]] = []
        self.unsubscribed: list[tuple[str, str]] = []

    def retrieve(self, persona_id: str, query: str, top_k: int = 10):
        if self.retrieve_errors:
            raise self.retrieve_errors.pop(0)
        self.retrieves.append((persona_id, query, top_k))
        return {
            "results": [
                {"tenant": "org:persona:user-1", "text": "I kept a diary"},
                {"tenant": 1, "text": 2},
            ]
        }

    def chat(self, persona_id: str, message: str, session_id: str | None = None):
        if self.chat_error is not None:
            raise self.chat_error
        return PersonaReply(
            messages=["The river was high."],
            memories_used=[{"gid": 1}],
            session_id=session_id or "sess-1",
            raw={"ok": True},
        )

    def converse(
        self,
        persona_id: str,
        text: str,
        session_id: str | None = None,
        speaker: str | None = None,
    ):
        self.converses.append(
            {
                "persona_id": persona_id,
                "text": text,
                "session_id": session_id,
                "speaker": speaker,
            }
        )
        return {"ok": True}

    def private(self, persona_id: str, user_id: str | None = None):
        self.private_calls.append((persona_id, user_id))
        return self

    def text(
        self,
        text: str,
        *,
        metadata: object = None,
        session_id: str | None = None,
    ):
        self.private_texts.append(text)
        return SimpleNamespace(
            gid=1,
            perception=None,
            incomplete=False,
            raw={"ok": True},
        )

    def create(self, name: str, handle: str, description: str):
        return _persona()

    def get(self, persona_id: str):
        return _persona()

    def delete(self, persona_id: str) -> None:
        return None

    def teach(self, persona_id: str, text: str):
        return {"taught": True}

    def answer(self, persona_id: str, question_key: str, text: str):
        return {"answered": True}

    def questions(self, persona_id: str):
        return [{"key": "q1"}]

    def subscribe(self, persona_id: str, user_id: str):
        self.subscribed.append((persona_id, user_id))
        return {"subscribed": True}

    def unsubscribe(self, persona_id: str, user_id: str):
        self.unsubscribed.append((persona_id, user_id))
        return {"unsubscribed": True}

    def subscribers(self, persona_id: str):
        return [{"user_id": "u1"}]


class FakeClient:
    def __init__(self) -> None:
        self.personas = FakePersonas()

    def close(self) -> None:
        return None


def test_retrieve_maps_hits_and_ignores_non_strings(
    settings: WorkerSettings,
) -> None:
    client = FakeClient()
    acting = "user-1"
    brain = EngramBrain(settings, acting, client=client)
    outcome = brain.retrieve("persona-1", "what do you remember", top_k=7)
    assert client.personas.retrieves == [("persona-1", "what do you remember", 7)]
    assert private_pool_owner(outcome.results[0].tenant) == acting
    assert outcome.results[0].text == "I kept a diary"
    assert outcome.results[1].tenant is None


def test_chat_and_persona_helpers(settings: WorkerSettings) -> None:
    client = FakeClient()
    brain = EngramBrain(settings, "user-1", client=client)
    created = brain.create_persona("Ada", "ada", "desc")
    assert created.id == "p1"
    assert brain.get_persona("p1").handle == "ada"
    brain.delete_persona("p1")
    assert brain.teach("p1", "fact") == {"taught": True}
    assert brain.answer("p1", "q", "a") == {"answered": True}
    assert brain.questions("p1") == [{"key": "q1"}]
    assert brain.subscribe("p1", "u1") == {"subscribed": True}
    assert brain.unsubscribe("p1", "u1") == {"unsubscribed": True}
    hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4"
    assert brain.subscribe("p1", hyphenated) == {"subscribed": True}
    assert client.personas.subscribed == [
        ("p1", "u1"),
        ("p1", "3a07018eb5c2483ab80f07e90488b5f4"),
    ]
    assert brain.subscribers("p1") == [{"user_id": "u1"}]
    outcome = brain.chat("persona-1", "hello", session_id="sess-9")
    assert outcome.messages == ["The river was high."]
    brain.converse("persona-1", "hi", session_id="sess-9", speaker="user")
    private = brain.ingest_private_text(
        "persona-1",
        "The caller lives in Pune.",
    )
    assert private.gid == 1
    assert client.personas.private_calls == [("persona-1", None)]
    assert client.personas.private_texts == ["The caller lives in Pune."]
    assert client.personas.converses[-1]["text"] == "hi"
    brain.close()


def test_retrieve_retries_then_maps_error(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    settings.engram_read_max_retries = 1
    monkeypatch.setattr("worker.engram.engram_brain.time.sleep", lambda _s: None)
    client = FakeClient()
    client.personas.retrieve_errors = [
        SdkServerError(503, "busy"),
        SdkUnauthorizedError(401, "no key"),
    ]
    brain = EngramBrain(settings, "user-1", client=client)
    with pytest.raises(app.UnauthorizedError):
        brain.retrieve("persona-1", "q")


def test_chat_forbidden_is_not_subscribed(settings: WorkerSettings) -> None:
    client = FakeClient()
    client.personas.chat_error = SdkForbiddenError(403, "no sub")
    brain = EngramBrain(settings, "user-1", client=client)
    with pytest.raises(app.NotSubscribedError):
        brain.chat("persona-1", "hello")


def test_map_sdk_error_statuses() -> None:
    assert isinstance(
        _map_sdk_error(SdkUnauthorizedError(401, "x")),
        app.UnauthorizedError,
    )
    forbidden = _map_sdk_error(SdkForbiddenError(403, "x"), chat=False)
    assert isinstance(forbidden, app.ForbiddenError)
    retryable = _map_sdk_error(SdkServerError(503, "busy"))
    assert isinstance(retryable, app.RetryableReadError)
    server = _map_sdk_error(SdkServerError(500, "down"))
    assert isinstance(server, app.ServerError)


def _scoped_settings(settings: WorkerSettings) -> WorkerSettings:
    return settings.model_copy(
        update={
            "engram_api_key": "egm_org_key",
            "engram_org_id": "org1",
            "engram_base_url": "https://engram.test",
            "engram_api_version_path": "/v1",
        },
    )


def _capture_http(handler: object) -> httpx.Client:
    return httpx.Client(
        base_url="https://engram.test",
        transport=httpx.MockTransport(handler),
    )


def test_retrieve_scoped_posts_query_top_k_scope_and_never_user_id(
    settings: WorkerSettings,
) -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "scope": "private",
                "tenants": ["org1:persona:user-1"],
                "results": [
                    {
                        "tenant": "org1:persona:user-1",
                        "text": "I kept a diary",
                    }
                ],
            },
        )

    loaded = _scoped_settings(settings)
    client = FakeClient()
    brain = EngramBrain(
        loaded,
        "user-1",
        client=client,
        api_key="jwt-member",
    )
    brain._owned_http = _capture_http(handler)
    brain._owns_http = True
    try:
        outcome = brain.retrieve_scoped(
            "p1",
            "what do you remember",
            scope=loaded.engram_retrieve_scope_private,
            top_k=loaded.engram_retrieve_top_k_private,
        )
        assert seen["method"] == "POST"
        assert seen["url"] == "https://engram.test/v1/orgs/org1/personas/p1/retrieve"
        assert seen["authorization"] == "Bearer jwt-member"
        assert seen["body"] == {
            "query": "what do you remember",
            "top_k": 25,
            "scope": loaded.engram_retrieve_scope_private,
        }
        assert "user_id" not in seen["body"]
        assert "egm_org_key" not in json.dumps(seen)
        assert private_pool_owner(outcome.results[0].tenant) == "user-1"
        assert outcome.results[0].text == "I kept a diary"
        assert client.personas.retrieves == []
    finally:
        brain.close()


def test_retrieve_scoped_org_brain_uses_org_key_not_member_token(
    settings: WorkerSettings,
) -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"scope": "shared", "tenants": [], "results": []},
        )

    loaded = _scoped_settings(settings)
    brain = EngramBrain(loaded, "user-1", client=FakeClient())
    brain._owned_http = _capture_http(handler)
    brain._owns_http = True
    try:
        brain.retrieve_scoped(
            "p1",
            "q",
            scope=loaded.engram_retrieve_scope_shared,
            top_k=7,
        )
        assert seen["authorization"] == "Bearer egm_org_key"
        assert seen["body"] == {
            "query": "q",
            "top_k": 7,
            "scope": loaded.engram_retrieve_scope_shared,
        }
        assert "user_id" not in seen["body"]
    finally:
        brain.close()


def test_retrieve_scoped_sends_typo_scope_and_maps_422(
    settings: WorkerSettings,
) -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            422,
            json={
                "detail": [
                    {
                        "type": "enum",
                        "loc": ["body", "scope"],
                        "msg": "extra_forbidden",
                    }
                ]
            },
        )

    loaded = _scoped_settings(settings)
    brain = EngramBrain(loaded, "user-1", client=FakeClient())
    brain._owned_http = _capture_http(handler)
    brain._owns_http = True
    try:
        with pytest.raises(app.ValidationError) as caught:
            brain.retrieve_scoped(
                "p1",
                "q",
                scope="not-a-scope",
                top_k=5,
            )
        assert seen["body"] == {
            "query": "q",
            "top_k": 5,
            "scope": "not-a-scope",
        }
        assert caught.value.status == 422
    finally:
        brain.close()


def test_post_persona_retrieve_refuses_user_id(settings: WorkerSettings) -> None:
    loaded = _scoped_settings(settings)
    brain = EngramBrain(loaded, "user-1", client=FakeClient())
    try:
        with pytest.raises(app.BrainError, match="user_id"):
            brain._post_persona_retrieve(
                "persona-1",
                {
                    "query": "q",
                    "top_k": 5,
                    "scope": loaded.engram_retrieve_scope_private,
                    "user_id": "user-1",
                },
            )
    finally:
        brain.close()


def test_retrieve_scoped_retries_then_maps_error(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    settings.engram_read_max_retries = 1
    monkeypatch.setattr("worker.engram.engram_brain.time.sleep", lambda _s: None)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, json={"detail": "busy"})
        return httpx.Response(401, json={"detail": "no key"})

    loaded = _scoped_settings(settings)
    loaded.engram_read_max_retries = 1
    brain = EngramBrain(loaded, "user-1", client=FakeClient())
    brain._owned_http = _capture_http(handler)
    brain._owns_http = True
    try:
        with pytest.raises(app.UnauthorizedError):
            brain.retrieve_scoped(
                "p1",
                "q",
                scope=loaded.engram_retrieve_scope_shared,
                top_k=5,
            )
        assert calls["n"] == 2
    finally:
        brain.close()


def test_retrieve_still_uses_sdk_path(settings: WorkerSettings) -> None:
    client = FakeClient()
    brain = EngramBrain(settings, "user-1", client=client)
    try:
        brain.retrieve("persona-1", "q", top_k=3)
        assert client.personas.retrieves == [("persona-1", "q", 3)]
    finally:
        brain.close()

