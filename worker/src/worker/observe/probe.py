"""Read Engram request logs for denials and errors. Metadata only; no bodies."""

from __future__ import annotations

import sys
from collections import Counter
from typing import Any

from engram_sdk.errors import EngramAPIError, EngramError
from engram_sdk.errors import ForbiddenError as SdkForbiddenError

from worker.config import load_settings
from worker.engram.factory import create_org_engram
from worker.observe.fields import turn_log_fields

failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failed
    extra = f" {detail}" if detail else ""
    if ok:
        print(f"{name}=ok{extra}")
        return
    print(f"{name}=FAIL{extra}", file=sys.stderr)
    failed += 1


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def main() -> int:
    settings = load_settings()
    leaked = turn_log_fields(
        settings,
        {
            "correlation_id": "11111111-1111-1111-1111-111111111111",
            "session_id": "22222222-2222-2222-2222-222222222222",
            "text": "should never be logged",
        },
    )
    check("log_fields_keep_correlation", "correlation_id" in leaked)
    check("log_fields_drop_text", "text" not in leaked)

    if (
        not settings.engram_api_key
        or not settings.engram_org_id
        or settings.engram_base_url is None
    ):
        print("engram_logs=SKIP Engram is not configured")
        if failed:
            print("PROBE_FAIL", file=sys.stderr)
            return 1
        print("PROBE_OK")
        return 0

    client = create_org_engram(settings)
    try:
        payload = client.insights.logs(limit=settings.engram_logs_limit)
    except SdkForbiddenError as exc:
        print(f"engram_logs=SKIP {exc} status={exc.status}")
        client.close()
        if failed:
            print("PROBE_FAIL", file=sys.stderr)
            return 1
        print("PROBE_OK")
        return 0
    except (EngramAPIError, EngramError) as exc:
        status = getattr(exc, "status", None)
        print(f"engram_logs=FAIL {exc} status={status}", file=sys.stderr)
        client.close()
        return 1
    except Exception as exc:
        print(f"engram_logs=FAIL {exc}", file=sys.stderr)
        client.close()
        return 1

    client.close()
    rows = _rows(payload)
    results = Counter(
        str(row["result"]) for row in rows if isinstance(row.get("result"), str)
    )
    denied = results.get(settings.engram_log_result_denied, 0)
    errors = results.get(settings.engram_log_result_error, 0)
    print(f"engram_logs_rows={len(rows)}")
    print(f"engram_logs_denied={denied}")
    print(f"engram_logs_errors={errors}")
    reasons = Counter(
        str(row["reason"])
        for row in rows
        if row.get("result")
        in {
            settings.engram_log_result_denied,
            settings.engram_log_result_error,
        }
        and isinstance(row.get("reason"), str)
    )
    for reason, count in reasons.most_common(5):
        print(f"engram_log_reason count={count} reason={reason}")
    check("engram_logs_readable", True)

    if failed:
        print("PROBE_FAIL", file=sys.stderr)
        return 1
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
