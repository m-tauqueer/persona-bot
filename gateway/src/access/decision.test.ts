import { describe, expect, it } from "vitest";
import { ACCESS_STATUS } from "../schema.js";
import {
  nextBatchStatus,
  nextSignInAction,
  parseBatchAction,
} from "./decision.js";

describe("nextSignInAction", () => {
  it("always provisions an owner", () => {
    expect(
      nextSignInAction({
        owner: true,
        hasUser: false,
        requestStatus: ACCESS_STATUS.DENIED,
      }),
    ).toEqual({ type: "provision", reason: "owner" });
  });

  it("refuses a denied request", () => {
    expect(
      nextSignInAction({
        owner: false,
        hasUser: false,
        requestStatus: ACCESS_STATUS.DENIED,
      }),
    ).toEqual({ type: "refuse", status: ACCESS_STATUS.DENIED });
  });

  it("refuses a revoked member", () => {
    expect(
      nextSignInAction({
        owner: false,
        hasUser: true,
        requestStatus: ACCESS_STATUS.REVOKED,
      }),
    ).toEqual({ type: "refuse", status: ACCESS_STATUS.REVOKED });
  });

  it("provisions an existing member", () => {
    expect(
      nextSignInAction({
        owner: false,
        hasUser: true,
        requestStatus: ACCESS_STATUS.ACTIVE,
      }),
    ).toEqual({ type: "provision", reason: "existing_member" });
  });

  it("provisions an approved request without a user row", () => {
    expect(
      nextSignInAction({
        owner: false,
        hasUser: false,
        requestStatus: ACCESS_STATUS.APPROVED,
      }),
    ).toEqual({ type: "provision", reason: "approved" });
  });

  it("waitlists a new identity", () => {
    expect(
      nextSignInAction({
        owner: false,
        hasUser: false,
        requestStatus: null,
      }),
    ).toEqual({ type: "waitlist" });
  });
});

describe("nextBatchStatus", () => {
  it("approves a requested identity", () => {
    expect(
      nextBatchStatus({
        action: "approve",
        current: ACCESS_STATUS.REQUESTED,
        hasUser: false,
        targetIsOwner: false,
        isSelf: false,
      }),
    ).toEqual({ ok: true, status: ACCESS_STATUS.APPROVED });
  });

  it("re-admits a revoked member as active", () => {
    expect(
      nextBatchStatus({
        action: "approve",
        current: ACCESS_STATUS.REVOKED,
        hasUser: true,
        targetIsOwner: false,
        isSelf: false,
      }),
    ).toEqual({ ok: true, status: ACCESS_STATUS.ACTIVE });
  });

  it("denies a pending request", () => {
    expect(
      nextBatchStatus({
        action: "deny",
        current: ACCESS_STATUS.REQUESTED,
        hasUser: false,
        targetIsOwner: false,
        isSelf: false,
      }),
    ).toEqual({ ok: true, status: ACCESS_STATUS.DENIED });
  });

  it("will not deny an existing member", () => {
    expect(
      nextBatchStatus({
        action: "deny",
        current: ACCESS_STATUS.ACTIVE,
        hasUser: true,
        targetIsOwner: false,
        isSelf: false,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("revokes an active member", () => {
    expect(
      nextBatchStatus({
        action: "revoke",
        current: ACCESS_STATUS.ACTIVE,
        hasUser: true,
        targetIsOwner: false,
        isSelf: false,
      }),
    ).toEqual({ ok: true, status: ACCESS_STATUS.REVOKED });
  });

  it("refuses revoke-of-self", () => {
    expect(
      nextBatchStatus({
        action: "revoke",
        current: ACCESS_STATUS.ACTIVE,
        hasUser: true,
        targetIsOwner: false,
        isSelf: true,
      }),
    ).toEqual({ ok: false, reason: "self" });
  });

  it("refuses deny or revoke of an owner", () => {
    expect(
      nextBatchStatus({
        action: "revoke",
        current: ACCESS_STATUS.ACTIVE,
        hasUser: true,
        targetIsOwner: true,
        isSelf: false,
      }),
    ).toEqual({ ok: false, reason: "owner_protected" });
  });

  it("maps configured action tokens", () => {
    expect(
      parseBatchAction("approve", {
        approve: "approve",
        deny: "deny",
        revoke: "revoke",
      }),
    ).toBe("approve");
    expect(
      parseBatchAction("nope", {
        approve: "approve",
        deny: "deny",
        revoke: "revoke",
      }),
    ).toBeNull();
  });
});
