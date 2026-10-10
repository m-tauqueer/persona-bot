from worker.engram.user_id import persona_engine_user_id, persona_engine_user_ids


def test_hyphenated_uuid_becomes_hex() -> None:
    hyphenated = "3A07018E-B5C2-483A-B80F-07E90488B5F4"
    assert persona_engine_user_id(hyphenated) == "3a07018eb5c2483ab80f07e90488b5f4"
    assert persona_engine_user_id("3a07018eb5c2483ab80f07e90488b5f4") == (
        "3a07018eb5c2483ab80f07e90488b5f4"
    )


def test_non_uuid_and_empty_are_unchanged() -> None:
    assert persona_engine_user_id("user-1") == "user-1"
    assert persona_engine_user_id("") == ""


def test_engine_user_ids_include_legacy_hyphenated_form() -> None:
    hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4"
    hex_id = "3a07018eb5c2483ab80f07e90488b5f4"
    assert persona_engine_user_ids(hyphenated) == (hex_id, hyphenated)
    assert persona_engine_user_ids(hex_id) == (hex_id,)
    assert persona_engine_user_ids("user-1") == ("user-1",)
