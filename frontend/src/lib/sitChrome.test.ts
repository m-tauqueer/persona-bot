import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMaxWidth } from "./sitChrome";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMaxWidth", () => {
  it("follows the configured media query", () => {
    const listeners = new Set<(event: { matches: boolean }) => void>();
    const media = {
      matches: true,
      addEventListener: (
        _type: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _type: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        listeners.delete(listener);
      },
    };
    vi.stubGlobal("matchMedia", () => media);
    const { result } = renderHook(() => useMaxWidth(720));
    expect(result.current).toBe(true);
  });
});
