import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_STATUS } from "../schema.js";
import { testConfig } from "../test/config.js";
import { mockReply } from "../test/http.js";
import { memoryRedis } from "../test/redis.js";
import { admitGoogleIdentity } from "./admit.js";

const getUserByGoogleSub = vi.fn();
const upsertGoogleUser = vi.fn();
const getAccessByGoogleSub = vi.fn();
const upsertActiveAccess = vi.fn();
const upsertWaitlistRequest = vi.fn();

vi.mock("./users.js", () => ({
  getUserByGoogleSub: (...args: unknown[]) => getUserByGoogleSub(...args),
  upsertGoogleUser: (...args: unknown[]) => upsertGoogleUser(...args),
}));

vi.mock("../access/store.js", () => ({
  getAccessByGoogleSub: (...args: unknown[]) => getAccessByGoogleSub(...args),
  upsertActiveAccess: (...args: unknown[]) => upsertActiveAccess(...args),
  upsertWaitlistRequest: (...args: unknown[]) => upsertWaitlistRequest(...args),
}));

const owner = {
  id: "11111111-1111-1111-1111-111111111111",
  googleSub: "sub-owner",
  email: "owner@example.com",
  engramUserId: "eng-owner",
};

describe("admitGoogleIdentity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("provisions a member without calling Engram subscribe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getUserByGoogleSub.mockResolvedValue(null);
    getAccessByGoogleSub.mockResolvedValue(null);
    upsertGoogleUser.mockResolvedValue(owner);
    upsertActiveAccess.mockResolvedValue(undefined);

    const result = await admitGoogleIdentity(
      {
        sql: {} as never,
        config: testConfig(),
        redis: memoryRedis() as never,
      },
      { sub: owner.googleSub, email: owner.email },
      undefined,
      mockReply(),
      { warn: vi.fn(), error: vi.fn() } as never,
    );

    expect(result.kind).toBe("member");
    expect(upsertGoogleUser).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waitlists a new identity without calling Engram subscribe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getUserByGoogleSub.mockResolvedValue(null);
    getAccessByGoogleSub.mockResolvedValue(null);

    const result = await admitGoogleIdentity(
      {
        sql: {} as never,
        config: testConfig({ OWNER_EMAILS: "someone-else@example.com" }),
        redis: memoryRedis() as never,
      },
      { sub: "sub-new", email: "new@example.com" },
      undefined,
      mockReply(),
      { warn: vi.fn(), error: vi.fn() } as never,
    );

    expect(result.kind).toBe("waitlist");
    expect(upsertWaitlistRequest).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a denied identity without calling Engram subscribe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getUserByGoogleSub.mockResolvedValue(null);
    getAccessByGoogleSub.mockResolvedValue({
      status: ACCESS_STATUS.DENIED,
    });

    const result = await admitGoogleIdentity(
      {
        sql: {} as never,
        config: testConfig({ OWNER_EMAILS: "someone-else@example.com" }),
        redis: memoryRedis() as never,
      },
      { sub: "sub-denied", email: "denied@example.com" },
      undefined,
      mockReply(),
      { warn: vi.fn(), error: vi.fn() } as never,
    );

    expect(result.kind).toBe("refused");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
