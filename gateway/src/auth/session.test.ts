import { describe, expect, it } from "vitest";
import { ACCESS_STATUS, SESSION_KIND } from "../schema.js";
import { testConfig } from "../test/config.js";
import { mockReply, mockRequest } from "../test/http.js";
import { memoryRedis } from "../test/redis.js";
import {
  destroySession,
  persistAuthSession,
  persistSessionRecord,
  readSessionAppUserId,
  readSessionRecord,
  storeOauthPending,
  takeOauthPending,
} from "./session.js";

const userId = "11111111-1111-1111-1111-111111111111";

describe("auth session", () => {
  it("round-trips a member session and slides expiry", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistAuthSession(redis as never, config, userId);
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBe(userId);
  });

  it("returns null for a forged cookie", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: "forged" },
      unsignCookie: () => ({ valid: false, value: "" }),
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBeNull();
  });

  it("returns null for a missing redis record", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: "missing" },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBeNull();
  });

  it("takes oauth pending once", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    await storeOauthPending(redis as never, config, "state-1", {
      nonce: "n",
      code_verifier: "v",
      next: "/dashboard",
    });
    await expect(
      takeOauthPending(redis as never, config, "state-1"),
    ).resolves.toEqual({
      nonce: "n",
      code_verifier: "v",
      next: "/dashboard",
    });
    await expect(
      takeOauthPending(redis as never, config, "state-1"),
    ).resolves.toBeNull();
  });

  it("returns null for invalid session JSON", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    redis.store.set(`${config.SESSION_REDIS_KEY_PREFIX}bad`, "{not-json");
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: "bad" },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBeNull();
  });

  it("returns null for a session record without app_user_id", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    redis.store.set(
      `${config.SESSION_REDIS_KEY_PREFIX}empty`,
      JSON.stringify({}),
    );
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: "empty" },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBeNull();
  });

  it("ignores invalid oauth pending JSON", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    redis.store.set(`${config.OAUTH_REDIS_KEY_PREFIX}broken`, "{");
    await expect(
      takeOauthPending(redis as never, config, "broken"),
    ).resolves.toBeNull();
  });

  it("clears a session even when the cookie is missing", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    await destroySession(redis as never, mockRequest({}), mockReply(), config);
  });

  it("reads a legacy member record without kind", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    redis.store.set(
      `${config.SESSION_REDIS_KEY_PREFIX}legacy`,
      JSON.stringify({ app_user_id: userId }),
    );
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: "legacy" },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBe(userId);
  });

  it("does not treat a waitlist record as a member", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistSessionRecord(redis as never, config, {
      kind: SESSION_KIND.WAITLIST,
      google_sub: "sub-wait",
      email: "wait@example.com",
      status: ACCESS_STATUS.REQUESTED,
    });
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBeNull();
    await expect(
      readSessionRecord(redis as never, request, config),
    ).resolves.toMatchObject({
      kind: SESSION_KIND.WAITLIST,
      email: "wait@example.com",
    });
  });

  it("clears a valid session cookie", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistAuthSession(redis as never, config, userId);
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    const reply = mockReply();
    await destroySession(redis as never, request, reply, config);
    expect(redis.store.size).toBe(0);
  });

  it("does not treat a consent record as a member", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistSessionRecord(redis as never, config, {
      kind: SESSION_KIND.CONSENT,
      google_sub: "sub-consent",
      email: "new@example.com",
      next: "/dashboard",
    });
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    await expect(
      readSessionAppUserId(redis as never, request, config),
    ).resolves.toBeNull();
    await expect(
      readSessionRecord(redis as never, request, config),
    ).resolves.toMatchObject({
      kind: SESSION_KIND.CONSENT,
      email: "new@example.com",
      next: "/dashboard",
    });
  });
});
