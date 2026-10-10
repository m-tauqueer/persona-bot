import { describe, expect, it } from "vitest";
import { DELETION_STATUS } from "../schema.js";
import {
  canDeleteAccount,
  confirmationMatches,
  consentIsCurrent,
  nextDeletionStatus,
  parseDeletionAction,
  sessionPastRetention,
} from "./decision.js";

const tokens = {
  request: "request",
  complete: "complete",
  cancel: "cancel",
};

describe("lifecycle decision", () => {
  it("requires matching privacy and terms versions", () => {
    expect(
      consentIsCurrent(null, { privacyVersion: "1", termsVersion: "1" }),
    ).toBe(false);
    expect(
      consentIsCurrent(
        { privacyVersion: "1", termsVersion: "1" },
        { privacyVersion: "1", termsVersion: "1" },
      ),
    ).toBe(true);
    expect(
      consentIsCurrent(
        { privacyVersion: "1", termsVersion: "1" },
        { privacyVersion: "2", termsVersion: "1" },
      ),
    ).toBe(false);
  });

  it("matches a confirmation phrase exactly after trim", () => {
    expect(confirmationMatches("DELETE MY DATA", "DELETE MY DATA")).toBe(true);
    expect(confirmationMatches(" DELETE MY DATA ", "DELETE MY DATA")).toBe(
      true,
    );
    expect(confirmationMatches("delete my data", "DELETE MY DATA")).toBe(false);
  });

  it("refuses owner accounts and owner-tooling self deletes", () => {
    expect(
      canDeleteAccount({
        targetIsOwner: true,
        isSelf: false,
        allowSelf: true,
      }),
    ).toEqual({ ok: false, reason: "owner_protected" });
    expect(
      canDeleteAccount({
        targetIsOwner: false,
        isSelf: true,
        allowSelf: false,
      }),
    ).toEqual({ ok: false, reason: "self" });
    expect(
      canDeleteAccount({
        targetIsOwner: false,
        isSelf: true,
        allowSelf: true,
      }),
    ).toEqual({ ok: true });
  });

  it("parses deletion actions from configured tokens", () => {
    expect(parseDeletionAction("complete", tokens)).toBe("complete");
    expect(parseDeletionAction("nope", tokens)).toBeNull();
  });

  it("allows a new request and only pending complete/cancel", () => {
    expect(nextDeletionStatus({ action: "request", current: null })).toEqual({
      ok: true,
      status: DELETION_STATUS.PENDING,
    });
    expect(
      nextDeletionStatus({
        action: "request",
        current: DELETION_STATUS.PENDING,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
    expect(
      nextDeletionStatus({
        action: "complete",
        current: DELETION_STATUS.PENDING,
      }),
    ).toEqual({ ok: true, status: DELETION_STATUS.COMPLETED });
    expect(
      nextDeletionStatus({
        action: "cancel",
        current: DELETION_STATUS.COMPLETED,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("retains open sessions and treats 0 as off", () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    expect(
      sessionPastRetention({
        endedAt: null,
        now,
        retentionDays: 30,
      }),
    ).toBe(false);
    expect(
      sessionPastRetention({
        endedAt: new Date("2026-01-01T00:00:00.000Z"),
        now,
        retentionDays: 0,
      }),
    ).toBe(false);
    expect(
      sessionPastRetention({
        endedAt: new Date("2026-01-01T00:00:00.000Z"),
        now,
        retentionDays: 30,
      }),
    ).toBe(true);
    expect(
      sessionPastRetention({
        endedAt: new Date("2026-09-01T00:00:00.000Z"),
        now,
        retentionDays: 30,
      }),
    ).toBe(false);
  });
});
