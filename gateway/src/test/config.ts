import { type GatewayConfig, loadGatewayConfig } from "../config.js";

export function testEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: "4100",
    GATEWAY_PUBLIC_URL: "http://localhost:5188",
    FRONTEND_ORIGIN: "http://localhost:5188",
    WORKER_URL: "http://localhost:8000",
    DATABASE_URL: "postgres://voice:voice@127.0.0.1:5434/voice",
    REDIS_URL: "redis://127.0.0.1:6379",
    SESSION_SECRET: "test-session-secret-16",
    INTERNAL_API_SECRET: "test-internal-secret16",
    GOOGLE_CLIENT_ID: "test-google-client",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    GOOGLE_CALLBACK_URL: "http://localhost:5188/auth/google/callback",
    GOOGLE_OIDC_DISCOVERY_URL:
      "https://accounts.google.com/.well-known/openid-configuration",
    OWNER_EMAILS: "owner@example.com",
    ...overrides,
  };
}

export function testConfig(
  overrides: Record<string, string> = {},
): GatewayConfig {
  return loadGatewayConfig(testEnv(overrides));
}
