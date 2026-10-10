import json
from pathlib import Path

import pytest

from worker.decisions.client import DecisionsClient
from worker.decisions.probe import load_cases, main, run_probe, verdict
from worker.decisions.types import ChoiceResult
from test_decisions import Stub, response

FIXTURE = Path(__file__).parent / "fixtures" / "decisions" / "scope.json"


def test_curated_cases_and_packaged_copy(settings):
    cases = load_cases(FIXTURE, settings)
    from worker.decisions import probe

    assert cases == json.loads(
        Path(probe.__file__).with_name("probe_fixture.json").read_text()
    )
    assert {case["expected"] for case in cases} == {"shared", "private", "both"}
    assert sum(bool(case["history"]) for case in cases) >= 4


def test_calibration_counts_wrong_narrowing_separately(settings):
    cases = load_cases(FIXTURE, settings)[:3]
    stub = Stub(lambda **kwargs: response(choice="private", confidence=0.8))
    api = DecisionsClient(settings, stub)
    try:
        report = run_probe(settings, cases, api, 0.9)
        assert report["counts"] == {"conservative_both": 3}
        assert report["outcomes"] == {"success": 3}
        assert report["sample_count"] == 3
        assert len(report["prompt_sha256"]) == 64
        assert "question" not in json.dumps(report)
        assert (
            verdict(
                ChoiceResult("memory_scope", "success", "private", 0.99),
                "shared",
                settings,
                0.9,
            )
            == "incorrect_narrowing"
        )
    finally:
        api.close()


def test_probe_missing_key_is_explicit_skip(settings, monkeypatch, capsys):
    import worker.decisions.probe as probe

    monkeypatch.setattr(
        probe,
        "load_settings",
        lambda: settings.model_copy(
            update={"decisions_api_key": None, "openai_api_key": None}
        ),
    )
    assert main([]) == 0
    assert "SKIP" in capsys.readouterr().out


@pytest.mark.parametrize("threshold", ["nan", "inf", "-1", "1.1"])
def test_probe_rejects_invalid_candidate(threshold):
    with pytest.raises(SystemExit):
        main(["--threshold", threshold])


def test_decision_logging_only_uses_safe_allowlisted_metadata(settings, monkeypatch):
    from worker.turn.service import TurnRunner
    from worker.engram.scope_router import ScopeDecision
    import worker.turn.service as service
    from uuid import uuid4

    runner = TurnRunner(settings)
    calls = []
    monkeypatch.setattr(
        service.log, "info", lambda event, **fields: calls.append(fields)
    )
    sid, cid = uuid4(), uuid4()
    try:
        runner._log_decisions_scope(
            ChoiceResult("memory_scope", "success", "private", 0.99),
            ScopeDecision("private", "caller"),
            30,
            2,
            sid,
            cid,
        )
        fields = calls[0]
        assert fields["session_id"] == str(sid)
        assert fields["correlation_id"] == str(cid)
        assert fields["scope_confidence"] == 0.99
        assert fields["scope_wait_ms"] == 2
        assert (
            not {"input", "question", "history", "api_key", "email", "response"}
            & fields.keys()
        )
    finally:
        runner.close()
