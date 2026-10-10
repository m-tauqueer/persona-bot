import { describe, expect, it } from "vitest";
import { rateLimitEnabled } from "../config.js";
import { testConfig } from "../test/config.js";
import { mockRequest } from "../test/http.js";
import { memoryRedis } from "../test/redis.js";
import { rateLimitKey, rateLimitPluginOptions } from "./rateLimit.js";
import { persistAuthSession } from "./session.js";

describe("rate-limit wiring", () => {
  it("is on when the flag is true", () => {
    expect(rateLimitEnabled(testConfig({ RATE_LIMIT_ENABLED: "true" }))).toBe(
      true,
    );
    expect(rateLimitEnabled(testConfig({ RATE_LIMIT_ENABLED: "false" }))).toBe(
      false,
    );
  });

  it("passes configured max, window, prefix, and fail-open", () => {
    const config = testConfig({
      RATE_LIMIT_MAX: "12",
      RATE_LIMIT_WINDOW_MS: "4000",
      RATE_LIMIT_REDIS_PREFIX: "rl-test:",
    });
    expect(rateLimitPluginOptions(config)).toEqual({
      max: 12,
      timeWindow: 4000,
      nameSpace: "rl-test:",
      skipOnError: true,
    });
  });

  it("keys a member by user id and everyone else by IP", () => {
    expect(
      rateLimitKey({
        userId: "user-1",
        ip: "10.0.0.2",
        userPrefix: "user:",
        ipPrefix: "ip:",
      }),
    ).toBe("user:user-1");
    expect(
      rateLimitKey({
        userId: null,
        ip: "10.0.0.2",
        userPrefix: "user:",
        ipPrefix: "ip:",
      }),
    ).toBe("ip:10.0.0.2");
  });

  it("resolves a member cookie in the plugin key generator", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const userId = "11111111-1111-1111-1111-111111111111";
    const sessionId = await persistAuthSession(redis as never, config, userId);
    const options = rateLimitPluginOptions(config, { redis: redis as never });
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
      ip: "10.0.0.9",
    });
    expect("keyGenerator" in options).toBe(true);
    if (!("keyGenerator" in options) || !options.keyGenerator) {
      throw new Error("missing keyGenerator");
    }
    await expect(options.keyGenerator(request)).resolves.toBe(`user:${userId}`);
  });
});
