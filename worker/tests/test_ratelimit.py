from worker.config import WorkerSettings
from worker.ratelimit import close_rate_limit, register_auth_failure


class FakeRedis:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, key: str, seconds: int) -> None:
        self.ttls[key] = seconds


def test_disabled_throttle_never_trips(settings: WorkerSettings) -> None:
    settings.rate_limit_enabled = False
    assert register_auth_failure(settings, "1.2.3.4") is False


def test_missing_redis_fails_open(settings: WorkerSettings) -> None:
    settings.rate_limit_enabled = True
    settings.redis_url = None
    close_rate_limit()
    assert register_auth_failure(settings, "1.2.3.4") is False


def test_trips_after_configured_failures(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    settings.rate_limit_enabled = True
    settings.internal_auth_max_failures = 2
    settings.internal_auth_failure_window_seconds = 30
    settings.rate_limit_redis_prefix = "rl:"
    fake = FakeRedis()
    monkeypatch.setattr("worker.ratelimit._redis", lambda _settings: fake)
    assert register_auth_failure(settings, "10.0.0.1") is False
    assert register_auth_failure(settings, "10.0.0.1") is False
    assert register_auth_failure(settings, "10.0.0.1") is True
    key = "rl:auth-fail:10.0.0.1"
    assert fake.counts[key] == 3
    assert fake.ttls[key] == 30


def test_close_rate_limit_clears_client(monkeypatch) -> None:
    class Client:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    import worker.ratelimit as ratelimit

    client = Client()
    ratelimit._client = client
    ratelimit._client_url = "redis://localhost"
    close_rate_limit()
    assert client.closed is True
    assert ratelimit._client is None
    close_rate_limit()


def test_redis_error_fails_open(settings: WorkerSettings, monkeypatch) -> None:
    settings.rate_limit_enabled = True

    class Boom:
        def incr(self, key: str) -> int:
            raise RuntimeError("down")

    monkeypatch.setattr("worker.ratelimit._redis", lambda _settings: Boom())
    assert register_auth_failure(settings, "10.0.0.1") is False
