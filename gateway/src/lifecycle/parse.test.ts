import { describe, expect, it } from "vitest";
import {
  decodeDeletionCursor,
  encodeDeletionCursor,
  parseDeletionStatus,
} from "./parse.js";

describe("lifecycle parse", () => {
  it("accepts known deletion statuses", () => {
    expect(parseDeletionStatus("pending")).toBe("pending");
    expect(parseDeletionStatus("nope")).toBeNull();
  });

  it("round-trips a deletion cursor", () => {
    const encoded = encodeDeletionCursor({
      requested_at: new Date("2026-09-06T00:00:00.000Z"),
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(decodeDeletionCursor(encoded)).toEqual({
      requestedAt: new Date("2026-09-06T00:00:00.000Z"),
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(decodeDeletionCursor("not-base64")).toBeNull();
  });
});
