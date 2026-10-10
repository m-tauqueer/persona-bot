from __future__ import annotations

import base64

import pytest

from worker.config import WorkerSettings
from worker.engram.member_secret import MEMBER_SECRET_KEY_BYTES

TEST_MEMBER_SECRET_KEY = base64.b64encode(b"c" * MEMBER_SECRET_KEY_BYTES).decode(
    "ascii",
)


@pytest.fixture
def settings() -> WorkerSettings:
    return WorkerSettings(
        _env_file=None,
        node_env="test",
        log_level="warning",
        worker_host="127.0.0.1",
        worker_port=9,
        database_url="postgresql://voice:voice@127.0.0.1:5434/voice",
        internal_api_secret="x" * 16,
        memory_panel_query="what do you remember",
        redis_url=None,
        openai_model="gpt-4o-mini",
        engram_member_secret_key=TEST_MEMBER_SECRET_KEY,
    )
