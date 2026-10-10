#!/usr/bin/env python3
"""Merge local env into production files. Do not print secret values."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse, urlunparse

URL_RETARGET_KEYS = (
    "GATEWAY_PUBLIC_URL",
    "FRONTEND_ORIGIN",
    "VITE_GATEWAY_URL",
    "GOOGLE_CALLBACK_URL",
    "POST_LOGIN_REDIRECT_URL",
)

BOOT_KEYS = (
    "SESSION_SECRET",
    "INTERNAL_API_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL",
)

SITTING_KEYS = (
    "DEEPGRAM_API_KEY",
    "ENGRAM_API_KEY",
    "ENGRAM_ORG_ID",
    "OPENAI_API_KEY",
)


def parse_dotenv(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        out[key] = _unquote(value.strip())
    return out


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        inner = value[1:-1]
        if value[0] == '"':
            return inner.encode("utf-8").decode("unicode_escape")
        return inner
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    return value


def dump_dotenv(values: Mapping[str, str]) -> str:
    lines: list[str] = []
    for key in values:
        lines.append(f"{key}={_quote(values[key])}")
    return "\n".join(lines) + "\n"


def _quote(value: str) -> str:
    if value == "":
        return ""
    needs = any(ch in value for ch in ' \t#\'"\\\n')
    if not needs:
        return value
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
    )
    return f'"{escaped}"'


def retarget_url(current: str, origin: str) -> str:
    parsed = urlparse(current)
    target = urlparse(origin)
    path = parsed.path
    return urlunparse(
        (
            target.scheme,
            target.netloc,
            path,
            parsed.params,
            parsed.query,
            parsed.fragment,
        )
    )


def merge_production(
    source: Mapping[str, str],
    *,
    public_origin: str,
    worker_url: str,
    database_url: str,
    redis_url: str,
) -> dict[str, str]:
    merged = dict(source)
    origin = public_origin.rstrip("/")
    for key in URL_RETARGET_KEYS:
        current = merged.get(key)
        if current:
            merged[key] = retarget_url(current, origin)
        else:
            merged[key] = origin
    merged["NODE_ENV"] = "production"
    merged["SESSION_COOKIE_SECURE"] = "true"
    merged["WORKER_URL"] = worker_url
    merged["BYO_LLM_PUBLIC_URL"] = origin
    merged["DATABASE_URL"] = database_url
    merged["REDIS_URL"] = redis_url
    merged["VOICE_AUDIO_PERSIST_ENABLED"] = "false"
    merged["WORKER_OPENAPI_ENABLED"] = "false"
    merged["GATEWAY_HOST"] = "0.0.0.0"
    merged["WORKER_HOST"] = "0.0.0.0"
    merged.pop("BYO_LLM_ENDPOINT_EXTRA_HEADERS", None)
    return merged


def build_env(merged: Mapping[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    origin = merged.get("FRONTEND_ORIGIN")
    if origin:
        out["FRONTEND_ORIGIN"] = origin
    port = merged.get("GATEWAY_PORT")
    if port:
        out["GATEWAY_PORT"] = port
    for key, value in merged.items():
        if key.startswith("VITE_"):
            out[key] = value
    return out


def missing_keys(values: Mapping[str, str], keys: tuple[str, ...]) -> list[str]:
    missing: list[str] = []
    for key in keys:
        value = values.get(key)
        if value is None or value.strip() == "":
            missing.append(key)
    return missing


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    path.chmod(0o600)


def yaml_literal(value: str, indent: int) -> str:
    pad = " " * indent
    lines = value.splitlines() or [""]
    return "\n".join(f"{pad}{line}" for line in lines)


def sidecar_app_yaml(
    *,
    name: str,
    location: str,
    environment_id: str,
    web_image: str,
    gateway_image: str,
    worker_image: str,
    acr_server: str,
    acr_username: str,
    acr_password: str,
    app_env: str,
    extra_env: Mapping[str, str],
    gateway_port: int,
    worker_port: int,
    min_replicas: int,
    max_replicas: int,
) -> str:
    secrets = [
        "      - name: acr-password",
        f"        value: {json.dumps(acr_password)}",
        "      - name: app-env",
        "        value: |",
        yaml_literal(app_env, 10),
    ]
    web_env = "\n".join(
        f"          - name: {key}\n            value: {json.dumps(value)}"
        for key, value in extra_env.items()
    )
    return f"""location: {location}
name: {name}
type: Microsoft.App/containerApps
properties:
  managedEnvironmentId: {environment_id}
  configuration:
    activeRevisionsMode: Single
    secrets:
{chr(10).join(secrets)}
    registries:
      - server: {acr_server}
        username: {acr_username}
        passwordSecretRef: acr-password
    ingress:
      external: true
      targetPort: 80
      transport: http
      allowInsecure: false
      traffic:
        - latestRevision: true
          weight: 100
  template:
    volumes:
      - name: env
        storageType: Secret
        secrets:
          - secretRef: app-env
            path: app.env
    containers:
      - name: web
        image: {web_image}
        resources:
          cpu: 0.25
          memory: 0.5Gi
        env:
{web_env}
        probes:
          - type: Liveness
            httpGet:
              path: /healthz
              port: 80
            periodSeconds: 30
          - type: Readiness
            httpGet:
              path: /healthz
              port: 80
            periodSeconds: 10
      - name: gateway
        image: {gateway_image}
        resources:
          cpu: 0.5
          memory: 1Gi
        env:
          - name: ENV_FILE
            value: /run/secrets/app.env
        volumeMounts:
          - volumeName: env
            mountPath: /run/secrets
        probes:
          - type: Liveness
            httpGet:
              path: /health
              port: {gateway_port}
            periodSeconds: 30
          - type: Startup
            httpGet:
              path: /health
              port: {gateway_port}
            periodSeconds: 10
            failureThreshold: 30
      - name: worker
        image: {worker_image}
        resources:
          cpu: 1.0
          memory: 2Gi
        env:
          - name: ENV_FILE
            value: /run/secrets/app.env
        volumeMounts:
          - volumeName: env
            mountPath: /run/secrets
        probes:
          - type: Liveness
            httpGet:
              path: /health
              port: {worker_port}
            periodSeconds: 30
          - type: Startup
            httpGet:
              path: /health
              port: {worker_port}
            periodSeconds: 10
            failureThreshold: 18
    scale:
      minReplicas: {min_replicas}
      maxReplicas: {max_replicas}
"""


def _cmd_require(args: argparse.Namespace) -> int:
    source = parse_dotenv(Path(args.source).read_text(encoding="utf-8"))
    boot_missing = missing_keys(source, BOOT_KEYS)
    sitting_missing = missing_keys(source, SITTING_KEYS)
    if boot_missing:
        print("missing boot keys: " + ", ".join(boot_missing), file=sys.stderr)
    if sitting_missing:
        print("missing sitting keys: " + ", ".join(sitting_missing), file=sys.stderr)
    if boot_missing or sitting_missing:
        return 1
    print("local env has the boot and sitting keys")
    return 0


def _cmd_merge(args: argparse.Namespace) -> int:
    source = parse_dotenv(Path(args.source).read_text(encoding="utf-8"))
    boot_missing = missing_keys(source, BOOT_KEYS)
    if boot_missing:
        print("missing boot keys: " + ", ".join(boot_missing), file=sys.stderr)
        return 1
    sitting_missing = missing_keys(source, SITTING_KEYS)
    if sitting_missing:
        print("missing sitting keys: " + ", ".join(sitting_missing), file=sys.stderr)
        return 1
    merged = merge_production(
        source,
        public_origin=args.public_origin,
        worker_url=args.worker_url,
        database_url=args.database_url,
        redis_url=args.redis_url,
    )
    write_text(Path(args.app_env), dump_dotenv(merged))
    write_text(Path(args.build_env), dump_dotenv(build_env(merged)))
    think = merged.get("BYO_LLM_CHAT_COMPLETIONS_PATH", "/v1/chat/completions")
    voice_ws = merged.get("VOICE_WS_PATH", "/ws/voice")
    ingest = int(merged.get("ADMIN_INGEST_MAX_BYTES") or "8388608")
    clone = int(merged.get("ADMIN_FISH_CLONE_MAX_BYTES") or "10485760")
    body = max(ingest, clone)
    mib = max(1, (body + (1024 * 1024) - 1) // (1024 * 1024))
    meta = {
        "think_path": think,
        "voice_ws_path": voice_ws,
        "nginx_client_max_body": f"{mib}m",
        "gateway_port": merged.get("GATEWAY_PORT", "4100"),
        "worker_port": merged.get("WORKER_PORT", "8000"),
        "google_callback_url": merged["GOOGLE_CALLBACK_URL"],
        "frontend_origin": merged["FRONTEND_ORIGIN"],
    }
    write_text(Path(args.meta), json.dumps(meta, indent=2) + "\n")
    print("wrote production env files")
    return 0


def _cmd_sidecar_yaml(args: argparse.Namespace) -> int:
    extra = json.loads(args.extra_env) if args.extra_env else {}
    text = sidecar_app_yaml(
        name=args.name,
        location=args.location,
        environment_id=args.environment_id,
        web_image=args.web_image,
        gateway_image=args.gateway_image,
        worker_image=args.worker_image,
        acr_server=args.acr_server,
        acr_username=args.acr_username,
        acr_password=args.acr_password,
        app_env=Path(args.app_env).read_text(encoding="utf-8"),
        extra_env=extra,
        gateway_port=args.gateway_port,
        worker_port=args.worker_port,
        min_replicas=args.min_replicas,
        max_replicas=args.max_replicas,
    )
    write_text(Path(args.out), text)
    print(f"wrote {args.name} yaml")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    require = sub.add_parser("require")
    require.add_argument("--source", required=True)
    require.set_defaults(func=_cmd_require)

    merge = sub.add_parser("merge")
    merge.add_argument("--source", required=True)
    merge.add_argument("--public-origin", required=True)
    merge.add_argument("--worker-url", required=True)
    merge.add_argument("--database-url", required=True)
    merge.add_argument("--redis-url", required=True)
    merge.add_argument("--app-env", required=True)
    merge.add_argument("--build-env", required=True)
    merge.add_argument("--meta", required=True)
    merge.set_defaults(func=_cmd_merge)

    sidecar = sub.add_parser("sidecar-yaml")
    sidecar.add_argument("--out", required=True)
    sidecar.add_argument("--name", required=True)
    sidecar.add_argument("--location", required=True)
    sidecar.add_argument("--environment-id", required=True)
    sidecar.add_argument("--web-image", required=True)
    sidecar.add_argument("--gateway-image", required=True)
    sidecar.add_argument("--worker-image", required=True)
    sidecar.add_argument("--acr-server", required=True)
    sidecar.add_argument("--acr-username", required=True)
    sidecar.add_argument("--acr-password", required=True)
    sidecar.add_argument("--app-env", required=True)
    sidecar.add_argument("--extra-env", default="{}")
    sidecar.add_argument("--gateway-port", type=int, required=True)
    sidecar.add_argument("--worker-port", type=int, required=True)
    sidecar.add_argument("--min-replicas", type=int, default=1)
    sidecar.add_argument("--max-replicas", type=int, default=2)
    sidecar.set_defaults(func=_cmd_sidecar_yaml)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
