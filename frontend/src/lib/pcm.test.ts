import { describe, expect, it } from "vitest";
import { uplinkMicFrame } from "./pcm";

describe("uplinkMicFrame", () => {
  it("passes the live frame through when the mic is open", () => {
    const frame = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(uplinkMicFrame(frame, false)).toBe(frame);
  });

  it("replaces the live frame with silence of the same size when muted", () => {
    const frame = new Uint8Array([9, 8, 7, 6]).buffer;
    const muted = uplinkMicFrame(frame, true);
    expect(muted).not.toBe(frame);
    expect(muted.byteLength).toBe(frame.byteLength);
    expect([...new Uint8Array(muted)]).toEqual([0, 0, 0, 0]);
  });
});
