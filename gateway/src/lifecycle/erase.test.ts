import { describe, expect, it } from "vitest";
import { eraseMayWipeLocalRows, mergeEngramStatus } from "./erase.js";

describe("mergeEngramStatus", () => {
  it("stays skipped until a persona is attempted", () => {
    expect(mergeEngramStatus("skipped", "skipped")).toBe("skipped");
    expect(mergeEngramStatus("skipped", "ok")).toBe("ok");
  });

  it("keeps ok when every persona purge succeeded", () => {
    expect(mergeEngramStatus("ok", "ok")).toBe("ok");
  });

  it("marks mixed outcomes partial so one failure cannot look complete", () => {
    expect(mergeEngramStatus("ok", "failed")).toBe("partial");
    expect(mergeEngramStatus("failed", "ok")).toBe("partial");
    expect(mergeEngramStatus("ok", "partial")).toBe("partial");
  });

  it("stays failed when every attempted purge failed", () => {
    expect(mergeEngramStatus("failed", "failed")).toBe("failed");
  });
});

describe("eraseMayWipeLocalRows", () => {
  it("deletes our rows only once Engram is clear", () => {
    expect(eraseMayWipeLocalRows("ok")).toBe(true);
    expect(eraseMayWipeLocalRows("skipped")).toBe(true);
  });

  it("keeps our rows when memory may still be there", () => {
    expect(eraseMayWipeLocalRows("partial")).toBe(false);
    expect(eraseMayWipeLocalRows("failed")).toBe(false);
  });
});
