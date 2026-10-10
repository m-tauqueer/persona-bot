import { describe, expect, it } from "vitest";
import {
  firstQuotaHit,
  quotaAppliesToCaller,
  quotaExceeded,
  quotaLimitActive,
  quotaShouldWarn,
} from "./decision.js";

describe("quota decision", () => {
  it("does not apply to an owner", () => {
    expect(quotaAppliesToCaller(true)).toBe(false);
    expect(quotaAppliesToCaller(false)).toBe(true);
  });

  it("treats a zero limit as off", () => {
    expect(quotaLimitActive(0)).toBe(false);
    expect(quotaExceeded(99, 0)).toBe(false);
    expect(quotaShouldWarn(99, 0, 0.8)).toBe(false);
  });

  it("is exceeded when used meets the cap", () => {
    expect(quotaExceeded(10, 10)).toBe(true);
    expect(quotaExceeded(9, 10)).toBe(false);
  });

  it("warns at the configured ratio", () => {
    expect(quotaShouldWarn(8, 10, 0.8)).toBe(true);
    expect(quotaShouldWarn(7, 10, 0.8)).toBe(false);
  });

  it("hits turns before minutes", () => {
    expect(
      firstQuotaHit({
        turnsUsed: 10,
        turnsLimit: 10,
        turnsKind: "turns",
        minutesUsed: 99,
        minutesLimit: 10,
        minutesKind: "minutes",
      }),
    ).toBe("turns");
    expect(
      firstQuotaHit({
        turnsUsed: 1,
        turnsLimit: 10,
        turnsKind: "turns",
        minutesUsed: 10,
        minutesLimit: 10,
        minutesKind: "minutes",
      }),
    ).toBe("minutes");
    expect(
      firstQuotaHit({
        turnsUsed: 1,
        turnsLimit: 10,
        turnsKind: "turns",
        minutesUsed: 1,
        minutesLimit: 10,
        minutesKind: "minutes",
      }),
    ).toBeNull();
  });
});
