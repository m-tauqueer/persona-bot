import { describe, expect, it } from "vitest";
import { ACCESS_STATUS } from "../schema.js";
import {
  decodeAccessCursor,
  encodeAccessCursor,
  parseAccessStatus,
} from "./parse.js";

describe("access parse", () => {
  it("accepts known statuses only", () => {
    expect(parseAccessStatus(ACCESS_STATUS.REQUESTED)).toBe(
      ACCESS_STATUS.REQUESTED,
    );
    expect(parseAccessStatus("not-a-status")).toBeNull();
  });

  it("round-trips a queue cursor", () => {
    const requestedAt = new Date("2026-01-02T03:04:05.000Z");
    const id = "22222222-2222-2222-2222-222222222222";
    const encoded = encodeAccessCursor({ requested_at: requestedAt, id });
    expect(decodeAccessCursor(encoded)).toEqual({ requestedAt, id });
  });

  it("rejects a forged cursor", () => {
    expect(decodeAccessCursor("%%%%")).toBeNull();
  });
});
