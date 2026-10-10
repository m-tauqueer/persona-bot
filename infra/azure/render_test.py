#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from render import (
    BOOT_KEYS,
    SITTING_KEYS,
    build_env,
    dump_dotenv,
    merge_production,
    missing_keys,
    parse_dotenv,
    retarget_url,
)


class RenderTests(unittest.TestCase):
    def test_retarget_keeps_path_from_source(self) -> None:
        self.assertEqual(
            retarget_url(
                "http://localhost:5188/auth/google/callback",
                "https://bot.metacog.in",
            ),
            "https://bot.metacog.in/auth/google/callback",
        )
        self.assertEqual(
            retarget_url(
                "http://localhost:5188/dashboard",
                "https://bot.metacog.in",
            ),
            "https://bot.metacog.in/dashboard",
        )

    def test_merge_overrides_public_urls_only(self) -> None:
        source = {
            "GATEWAY_PUBLIC_URL": "http://localhost:5188",
            "FRONTEND_ORIGIN": "http://localhost:5188",
            "VITE_GATEWAY_URL": "http://localhost:5188",
            "GOOGLE_CALLBACK_URL": "http://localhost:5188/auth/google/callback",
            "POST_LOGIN_REDIRECT_URL": "http://localhost:5188/dashboard",
            "WORKER_URL": "http://localhost:8000",
            "NOTE_LOCAL": "http://localhost:9/keep",
            "GATEWAY_PORT": "4100",
            "VITE_VOICE_WS_PATH": "/ws/voice",
            "SESSION_SECRET": "x" * 16,
            "BYO_LLM_ENDPOINT_EXTRA_HEADERS": '{"ngrok-skip-browser-warning":"true"}',
        }
        merged = merge_production(
            source,
            public_origin="https://bot.metacog.in",
            worker_url="http://worker",
            database_url="postgres://u:p@db/voicebot?sslmode=require",
            redis_url="rediss://:k@redis:6380/0",
        )
        self.assertEqual(merged["FRONTEND_ORIGIN"], "https://bot.metacog.in")
        self.assertEqual(
            merged["GOOGLE_CALLBACK_URL"],
            "https://bot.metacog.in/auth/google/callback",
        )
        self.assertEqual(
            merged["POST_LOGIN_REDIRECT_URL"],
            "https://bot.metacog.in/dashboard",
        )
        self.assertEqual(merged["WORKER_URL"], "http://worker")
        self.assertEqual(merged["BYO_LLM_PUBLIC_URL"], "https://bot.metacog.in")
        self.assertEqual(merged["VOICE_AUDIO_PERSIST_ENABLED"], "false")
        self.assertEqual(merged["NOTE_LOCAL"], "http://localhost:9/keep")
        self.assertEqual(merged["NODE_ENV"], "production")
        self.assertEqual(merged["SESSION_COOKIE_SECURE"], "true")
        self.assertNotIn("BYO_LLM_ENDPOINT_EXTRA_HEADERS", merged)

    def test_build_env_is_vite_only(self) -> None:
        merged = {
            "FRONTEND_ORIGIN": "https://bot.metacog.in",
            "GATEWAY_PORT": "4100",
            "VITE_GATEWAY_URL": "https://bot.metacog.in",
            "SESSION_SECRET": "secret",
            "GOOGLE_CLIENT_SECRET": "no",
        }
        built = build_env(merged)
        self.assertEqual(
            set(built),
            {"FRONTEND_ORIGIN", "GATEWAY_PORT", "VITE_GATEWAY_URL"},
        )

    def test_missing_keys_names_only(self) -> None:
        self.assertEqual(
            missing_keys({"SESSION_SECRET": "x" * 16}, BOOT_KEYS),
            [
                "INTERNAL_API_SECRET",
                "GOOGLE_CLIENT_ID",
                "GOOGLE_CLIENT_SECRET",
                "GOOGLE_CALLBACK_URL",
            ],
        )
        self.assertEqual(missing_keys({"DEEPGRAM_API_KEY": "k"}, SITTING_KEYS), [
            "ENGRAM_API_KEY",
            "ENGRAM_ORG_ID",
            "OPENAI_API_KEY",
        ])

    def test_dotenv_roundtrip_quoted(self) -> None:
        values = {"A": "plain", "B": "has space", "C": "hash # x"}
        parsed = parse_dotenv(dump_dotenv(values))
        self.assertEqual(parsed, values)

    def test_write_permissions(self) -> None:
        from render import write_text

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "app.env"
            write_text(path, "X=1\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_sidecar_yaml_shares_localhost(self) -> None:
        from render import sidecar_app_yaml

        text = sidecar_app_yaml(
            name="bot-web",
            location="centralus",
            environment_id="/subscriptions/x/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
            web_image="example.azurecr.io/web:1",
            gateway_image="example.azurecr.io/gateway:1",
            worker_image="example.azurecr.io/worker:1",
            acr_server="example.azurecr.io",
            acr_username="user",
            acr_password="pass",
            app_env="NODE_ENV=production\n",
            extra_env={"THINK_PATH": "/v1/chat/completions", "GATEWAY_PORT": "4100"},
            gateway_port=4100,
            worker_port=8000,
            min_replicas=1,
            max_replicas=2,
        )
        self.assertIn("name: web", text)
        self.assertIn("name: gateway", text)
        self.assertIn("name: worker", text)
        self.assertIn("/v1/chat/completions", text)
        self.assertIn("ENV_FILE", text)


if __name__ == "__main__":
    unittest.main()
