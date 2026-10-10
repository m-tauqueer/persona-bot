from worker.lifecycle.gids import (
    memory_gids,
    memory_rows,
    memory_text,
    next_cursor,
    row_gid,
)
from worker.lifecycle.purge import list_private_pool, purge_private_pool


class FakePersonas:
    def __init__(self) -> None:
        self.pages = [
            {
                "memories": [{"gid": 1001, "text": "a"}, {"gid": "1001"}],
                "next_cursor": "c2",
            },
            {"results": [{"id": 1002}]},
        ]
        self.forgotten: list[tuple[str, str, int | str]] = []
        self.unsubscribed: list[tuple[str, str]] = []
        self.forget_error: Exception | None = None
        self.unsubscribe_error: Exception | None = None

    def user_memories(self, persona_id: str, user_id: str, **params: object):
        assert persona_id == "persona-1"
        if params.get("cursor") == "c2":
            return self.pages[1]
        return self.pages[0]

    def forget_user_memory(
        self,
        persona_id: str,
        user_id: str,
        gid: int | str,
    ) -> None:
        if self.forget_error is not None:
            raise self.forget_error
        self.forgotten.append((persona_id, user_id, gid))

    def unsubscribe(self, persona_id: str, user_id: str) -> None:
        if self.unsubscribe_error is not None:
            raise self.unsubscribe_error
        self.unsubscribed.append((persona_id, user_id))


def test_memory_gids_from_known_shapes() -> None:
    assert memory_gids({"memories": [{"gid": 1}, {"id": "2"}]}) == [1, "2"]
    assert memory_rows([{"gid": 3}])[0]["gid"] == 3
    assert next_cursor({"next_cursor": "abc"}) == "abc"
    assert next_cursor({"next_cursor": "  "}) is None
    assert memory_text({"text": "The caller lives in Pune."}) == (
        "The caller lives in Pune."
    )
    assert memory_text({"text": 12}) is None
    assert row_gid({"gid": 1001}) == 1001
    assert row_gid({"id": "1002"}) == "1002"


def test_purge_forgets_each_gid_then_unsubscribes(settings) -> None:
    personas = FakePersonas()
    result = purge_private_pool(
        settings,
        engram_user_id="user-1",
        engram_persona_id="persona-1",
        personas=personas,
    )
    assert result == {"engram": "ok", "forgotten": 2, "unsubscribed": True}
    assert personas.forgotten == [
        ("persona-1", "user-1", 1001),
        ("persona-1", "user-1", 1002),
    ]
    assert personas.unsubscribed == [("persona-1", "user-1")]


def test_purge_hyphenated_uuid_clears_engine_and_legacy_ids(settings) -> None:
    personas = FakePersonas()
    hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4"
    hex_id = "3a07018eb5c2483ab80f07e90488b5f4"
    result = purge_private_pool(
        settings,
        engram_user_id=hyphenated,
        engram_persona_id="persona-1",
        personas=personas,
    )
    assert result["engram"] == "ok"
    assert result["forgotten"] == 4
    assert result["unsubscribed"] is True
    assert {user_id for _, user_id, _ in personas.forgotten} == {hex_id, hyphenated}
    assert personas.unsubscribed == [
        ("persona-1", hex_id),
        ("persona-1", hyphenated),
    ]


def test_purge_is_partial_when_forget_fails(settings) -> None:
    personas = FakePersonas()
    personas.forget_error = RuntimeError("nope")
    result = purge_private_pool(
        settings,
        engram_user_id="user-1",
        engram_persona_id="persona-1",
        personas=personas,
    )
    assert result["engram"] == "partial"
    assert result["forgotten"] == 0
    assert result["unsubscribed"] is True


def test_purge_skips_when_engram_is_off(settings) -> None:
    settings.engram_api_key = None
    result = purge_private_pool(
        settings,
        engram_user_id="user-1",
        engram_persona_id="persona-1",
    )
    assert result == {
        "engram": "skipped",
        "forgotten": 0,
        "unsubscribed": False,
    }


def test_purge_can_forget_without_unsubscribing(settings) -> None:
    personas = FakePersonas()
    result = purge_private_pool(
        settings,
        engram_user_id="user-1",
        engram_persona_id="persona-1",
        personas=personas,
        unsubscribe=False,
    )
    assert result == {
        "engram": "ok",
        "forgotten": 2,
        "unsubscribed": False,
    }
    assert personas.forgotten == [
        ("persona-1", "user-1", 1001),
        ("persona-1", "user-1", 1002),
    ]
    assert personas.unsubscribed == []


def test_list_private_pool_pages_and_dedupes(settings) -> None:
    personas = FakePersonas()
    result = list_private_pool(
        settings,
        engram_user_id="user-1",
        engram_persona_id="persona-1",
        personas=personas,
    )
    assert result["engram"] == "ok"
    assert result["count"] == 2
    assert result["memories"] == [
        {"gid": 1001, "text": "a"},
        {"gid": 1002, "text": None},
    ]


def test_list_private_pool_skips_when_engram_is_off(settings) -> None:
    settings.engram_api_key = None
    result = list_private_pool(
        settings,
        engram_user_id="user-1",
        engram_persona_id="persona-1",
    )
    assert result == {
        "engram": "skipped",
        "count": 0,
        "memories": [],
    }
