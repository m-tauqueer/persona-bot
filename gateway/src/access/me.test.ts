import { describe, expect, it } from "vitest";
import { ACCESS_STATUS } from "../schema.js";
import { resolveMeView } from "./me.js";

const labels = {
  active: "active",
  waitlisted: "waitlisted",
  denied: "denied",
  revoked: "revoked",
  consent: "consent",
};

const user = { id: "11111111-1111-1111-1111-111111111111", email: "a@x.com" };

describe("resolveMeView", () => {
  it("is unauthorized without an email", () => {
    expect(
      resolveMeView({
        hasMemberSession: false,
        user: null,
        requestStatus: null,
        email: null,
        owner: false,
        labels,
      }),
    ).toEqual({ http: 401 });
  });

  it("returns a member payload for an active member session", () => {
    expect(
      resolveMeView({
        hasMemberSession: true,
        user,
        requestStatus: ACCESS_STATUS.ACTIVE,
        email: user.email,
        owner: false,
        labels,
      }),
    ).toEqual({
      http: 200,
      body: {
        access: "active",
        id: user.id,
        email: user.email,
        owner: false,
      },
    });
  });

  it("keeps a waitlist cookie waitlisted after approval", () => {
    expect(
      resolveMeView({
        hasMemberSession: false,
        user: null,
        requestStatus: ACCESS_STATUS.APPROVED,
        email: "new@x.com",
        owner: false,
        labels,
      }),
    ).toEqual({
      http: 200,
      body: { access: "waitlisted", email: "new@x.com", owner: false },
    });
  });

  it("surfaces a live revoke on a member cookie", () => {
    expect(
      resolveMeView({
        hasMemberSession: true,
        user,
        requestStatus: ACCESS_STATUS.REVOKED,
        email: user.email,
        owner: false,
        labels,
      }),
    ).toEqual({
      http: 200,
      body: { access: "revoked", email: user.email, owner: false },
    });
  });

  it("still treats an owner as active after a revoke row", () => {
    expect(
      resolveMeView({
        hasMemberSession: true,
        user,
        requestStatus: ACCESS_STATUS.REVOKED,
        email: user.email,
        owner: true,
        labels,
      }),
    ).toEqual({
      http: 200,
      body: {
        access: "active",
        id: user.id,
        email: user.email,
        owner: true,
      },
    });
  });

  it("returns consent before membership when versions are stale", () => {
    expect(
      resolveMeView({
        hasMemberSession: false,
        user,
        requestStatus: ACCESS_STATUS.ACTIVE,
        email: user.email,
        owner: false,
        labels,
        needsConsent: true,
      }),
    ).toEqual({
      http: 200,
      body: {
        access: "consent",
        email: user.email,
        owner: false,
      },
    });
  });
});
