import { describe, expect, it } from "vitest";
import { memoryPanelReloadKey } from "./memoryPanel";

describe("memoryPanelReloadKey", () => {
  it("changes when the signed-in user changes", () => {
    const first = memoryPanelReloadKey("user-a", "ready", "p1");
    const second = memoryPanelReloadKey("user-b", "ready", "p1");
    expect(first).not.toBe(second);
  });

  it("changes when session status changes", () => {
    expect(memoryPanelReloadKey("user-a", "ready", "p1")).not.toBe(
      memoryPanelReloadKey("user-a", "signed_out", "p1"),
    );
  });

  it("changes when the pinned persona changes", () => {
    expect(memoryPanelReloadKey("user-a", "ready", "p1")).not.toBe(
      memoryPanelReloadKey("user-a", "ready", "p2"),
    );
  });

  it("treats a missing user as empty", () => {
    expect(memoryPanelReloadKey(undefined, "loading", undefined)).toBe(
      "loading::",
    );
  });
});
