from typing import Any

from worker.admin.store import pick_probe_persona, write_probe_persona
from worker.config import WorkerSettings

ADA = "11111111-1111-1111-1111-111111111111"
NOVA = "22222222-2222-2222-2222-222222222222"


def _row(persona_id: str, handle: str, *, published: bool) -> dict[str, Any]:
    return {"id": persona_id, "handle": handle, "published": published}


def test_takes_the_oldest_published_row_when_unpinned() -> None:
    rows = [
        _row(ADA, "ada", published=False),
        _row(NOVA, "nova", published=True),
    ]
    picked = pick_probe_persona(rows)
    assert picked is not None
    assert picked["handle"] == "nova"


def test_a_second_persona_does_not_break_a_probe() -> None:
    rows = [
        _row(ADA, "ada", published=True),
        _row(NOVA, "nova", published=True),
    ]
    picked = pick_probe_persona(rows)
    assert picked is not None
    assert picked["handle"] == "ada"


def test_a_pin_must_name_a_published_row() -> None:
    rows = [
        _row(ADA, "ada", published=True),
        _row(NOVA, "nova", published=False),
    ]
    picked = pick_probe_persona(rows, persona_id=NOVA)
    assert picked is None
    published = pick_probe_persona(rows, persona_id=ADA)
    assert published is not None
    assert published["handle"] == "ada"


def test_missing_pin_or_no_published_row_returns_none() -> None:
    rows = [_row(ADA, "ada", published=False)]
    assert pick_probe_persona(rows) is None
    assert pick_probe_persona(rows, persona_id=NOVA) is None
    assert pick_probe_persona([]) is None


def test_write_probe_persona_skips_when_unpinned(
    settings: WorkerSettings,
) -> None:
    settings.probe_persona_id = None
    assert write_probe_persona(None, settings) is None  # type: ignore[arg-type]
