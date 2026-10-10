import { describe, expect, it } from "vitest";
import { testConfig } from "../test/config.js";
import { mockReply, mockRequest } from "../test/http.js";
import { createRequireOwner } from "./owner.js";

const member = {
  id: "11111111-1111-1111-1111-111111111111",
  googleSub: "sub-1",
  email: "member@example.com",
  engramUserId: "11111111-1111-1111-1111-111111111111",
};

const owner = {
  ...member,
  email: "owner@example.com",
};

describe("createRequireOwner", () => {
  it("leaves an already-sent reply alone", async () => {
    const requireOwner = createRequireOwner(testConfig());
    const reply = mockReply();
    reply.code(401).send({ error: "unauthorized" });
    await requireOwner(mockRequest({ appUser: member }), reply);
    expect(reply.statusCode).toBe(401);
  });

  it("refuses a missing app user", async () => {
    const requireOwner = createRequireOwner(testConfig());
    const reply = mockReply();
    await requireOwner(mockRequest({}), reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: "unauthorized" });
  });

  it("refuses a signed-in non-owner", async () => {
    const requireOwner = createRequireOwner(testConfig());
    const reply = mockReply();
    await requireOwner(mockRequest({ appUser: member }), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: "forbidden" });
  });

  it("allows an owner email", async () => {
    const requireOwner = createRequireOwner(testConfig());
    const reply = mockReply();
    await requireOwner(mockRequest({ appUser: owner }), reply);
    expect(reply.sent).toBe(false);
    expect(reply.statusCode).toBe(200);
  });
});
