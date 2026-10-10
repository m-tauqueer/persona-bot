import { describe, expect, it } from "vitest";
import { testConfig } from "../test/config.js";
import { mockReply, mockRequest, queuedSql } from "../test/http.js";
import { memoryRedis } from "../test/redis.js";
import { createRequireAppUser } from "./guard.js";
import { persistAuthSession } from "./session.js";

const user = {
  id: "11111111-1111-1111-1111-111111111111",
  googleSub: "sub-1",
  email: "member@example.com",
  engramUserId: "11111111-1111-1111-1111-111111111111",
};

describe("createRequireAppUser", () => {
  it("refuses a missing cookie", async () => {
    const config = testConfig();
    const requireAppUser = createRequireAppUser({
      sql: queuedSql([]) as never,
      redis: memoryRedis() as never,
      config,
    });
    const request = mockRequest({});
    const reply = mockReply();
    await requireAppUser(request, reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: "unauthorized" });
    expect(request.appUser).toBeUndefined();
  });

  it("refuses a session whose user row is gone", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistAuthSession(redis as never, config, user.id);
    const requireAppUser = createRequireAppUser({
      sql: queuedSql([[]]) as never,
      redis: redis as never,
      config,
    });
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    const reply = mockReply();
    await requireAppUser(request, reply);
    expect(reply.statusCode).toBe(401);
  });

  it("attaches the user when the cookie and row match", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistAuthSession(redis as never, config, user.id);
    const requireAppUser = createRequireAppUser({
      sql: queuedSql([
        [
          {
            id: user.id,
            google_sub: user.googleSub,
            email: user.email,
            engram_user_id: user.engramUserId,
          },
        ],
        [],
      ]) as never,
      redis: redis as never,
      config,
    });
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    const reply = mockReply();
    await requireAppUser(request, reply);
    expect(reply.sent).toBe(false);
    expect(request.appUser).toEqual(user);
  });

  it("refuses a member cookie whose access was revoked", async () => {
    const config = testConfig();
    const redis = memoryRedis();
    const sessionId = await persistAuthSession(redis as never, config, user.id);
    const requireAppUser = createRequireAppUser({
      sql: queuedSql([
        [
          {
            id: user.id,
            google_sub: user.googleSub,
            email: user.email,
            engram_user_id: user.engramUserId,
          },
        ],
        [
          {
            id: "33333333-3333-3333-3333-333333333333",
            google_sub: user.googleSub,
            email: user.email,
            status: "revoked",
            requested_at: new Date(),
            decided_at: new Date(),
            user_id: user.id,
          },
        ],
      ]) as never,
      redis: redis as never,
      config,
    });
    const request = mockRequest({
      cookies: { [config.SESSION_COOKIE_NAME]: sessionId },
    });
    const reply = mockReply();
    await requireAppUser(request, reply);
    expect(reply.statusCode).toBe(401);
    expect(request.appUser).toBeUndefined();
  });
});
