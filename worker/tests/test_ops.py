from worker.ops.decision import (
    OPS_SERVICE_GATEWAY,
    OPS_SERVICE_WORKER,
    all_health_ok,
    health_row,
    parse_code_list,
    parse_ops_service,
    should_record_ops_code,
)


def test_parse_ops_service_only_known_tokens() -> None:
    assert parse_ops_service(OPS_SERVICE_GATEWAY) == OPS_SERVICE_GATEWAY
    assert parse_ops_service(OPS_SERVICE_WORKER) == OPS_SERVICE_WORKER
    assert parse_ops_service("browser") is None


def test_record_codes_skip_reconnect(settings) -> None:
    codes = parse_code_list(settings.ops_record_codes)
    assert should_record_ops_code(settings.failure_code_engram, codes)
    assert should_record_ops_code(settings.failure_code_database, codes)
    assert not should_record_ops_code("voice_reconnecting", codes)
    assert not should_record_ops_code("audio_not_stored", codes)


def test_insert_rejects_unknown_service() -> None:
    from worker.ops.store import insert_ops_event

    try:
        insert_ops_event(
            None,  # type: ignore[arg-type]
            service="browser",
            code="x",
            message="y",
        )
    except ValueError as exc:
        assert "unknown ops service" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_health_ok_requires_every_check() -> None:
    ok = health_row("postgres", True, "ok", "fail")
    down = health_row("redis", False, "ok", "fail")
    assert ok == {"name": "postgres", "status": "ok", "ok": True}
    assert down["status"] == "fail"
    assert all_health_ok([ok]) is True
    assert all_health_ok([ok, down]) is False
    assert all_health_ok([]) is False
