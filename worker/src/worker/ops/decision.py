OPS_SERVICE_GATEWAY = "gateway"
OPS_SERVICE_WORKER = "worker"


def parse_code_list(raw: str) -> set[str]:
    return {part for part in raw.replace(",", " ").split() if part}


def parse_ops_service(raw: str) -> str | None:
    if raw in {OPS_SERVICE_GATEWAY, OPS_SERVICE_WORKER}:
        return raw
    return None


def should_record_ops_code(code: str, record_codes: set[str]) -> bool:
    return code in record_codes


def health_row(
    name: str,
    ok: bool,
    ok_status: str,
    fail_status: str,
) -> dict[str, object]:
    return {"name": name, "status": ok_status if ok else fail_status, "ok": ok}


def all_health_ok(rows: list[dict[str, object]]) -> bool:
    return bool(rows) and all(bool(row.get("ok")) for row in rows)
