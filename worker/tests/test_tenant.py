from worker.engram.tenant import (
    is_own_private_pool,
    may_ground,
    private_pool_owner,
)

ORG = "100912164da2419885314c9fdb5358b7"
PERSONA = "3a07018eb5c2483ab80f07e90488b5f4"
MEMBER = "07b2b9f777c9446b86c5d593a374cc80"
OTHER = "8de1b2b278724e0bba19000086f8bef2"

SHARED = f"{ORG}:{PERSONA}"
OWN_PRIVATE = f"{ORG}:{PERSONA}:{MEMBER}"
OTHER_PRIVATE = f"{ORG}:{PERSONA}:{OTHER}"


def test_shared_pool_has_no_owner() -> None:
    assert private_pool_owner(SHARED) is None
    assert private_pool_owner(None) is None
    assert private_pool_owner("") is None


def test_private_pool_owner_is_the_last_segment() -> None:
    assert private_pool_owner(OWN_PRIVATE) == MEMBER


def test_private_pool_owner_accepts_a_hyphenated_uuid() -> None:
    hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4"
    assert (
        private_pool_owner(f"{ORG}:{PERSONA}:{hyphenated}")
        == "3a07018eb5c2483ab80f07e90488b5f4"
    )


def test_own_private_pool_only_matches_that_member() -> None:
    assert is_own_private_pool(OWN_PRIVATE, engram_user_id=MEMBER) is True
    assert is_own_private_pool(OWN_PRIVATE, engram_user_id=OTHER) is False


def test_shared_and_malformed_tenants_are_not_private() -> None:
    assert is_own_private_pool(SHARED, engram_user_id=MEMBER) is False
    assert is_own_private_pool(None, engram_user_id=MEMBER) is False
    assert (
        is_own_private_pool(f"{ORG}:{PERSONA}:", engram_user_id=MEMBER) is False
    )
    assert (
        is_own_private_pool(
            f"{ORG}:{PERSONA}:{MEMBER}:extra",
            engram_user_id=MEMBER,
        )
        is False
    )


def test_may_ground_shared_row() -> None:
    for authenticated in (True, False):
        assert (
            may_ground(
                SHARED,
                engram_user_id=MEMBER,
                member_authenticated=authenticated,
            )
            is True
        )
        assert (
            may_ground(
                SHARED,
                engram_user_id=OTHER,
                member_authenticated=authenticated,
            )
            is True
        )


def test_may_ground_own_private_row_when_authenticated_as_that_member() -> None:
    assert (
        may_ground(OWN_PRIVATE, engram_user_id=MEMBER, member_authenticated=True)
        is True
    )


def test_may_ground_refuses_private_rows_without_member_auth() -> None:
    # On one org key the only private pool retrieve returns is the key owner's,
    # and it holds every member's turns. Whoever signs in as that owner would
    # otherwise be handed all of it.
    assert (
        may_ground(OWN_PRIVATE, engram_user_id=MEMBER, member_authenticated=False)
        is False
    )
    assert (
        may_ground(OTHER_PRIVATE, engram_user_id=OTHER, member_authenticated=False)
        is False
    )


def test_may_ground_other_member_private_row() -> None:
    for authenticated in (True, False):
        assert (
            may_ground(
                OTHER_PRIVATE,
                engram_user_id=MEMBER,
                member_authenticated=authenticated,
            )
            is False
        )


def test_may_ground_missing_or_malformed_fails_closed() -> None:
    malformed = [
        None,
        "",
        ORG,
        f"{ORG}:{PERSONA}:",
        f"{ORG}:",
        f"{ORG}:{PERSONA}:{MEMBER}:extra",
    ]
    for tenant in malformed:
        for authenticated in (True, False):
            assert (
                may_ground(
                    tenant,
                    engram_user_id=MEMBER,
                    member_authenticated=authenticated,
                )
                is False
            )
