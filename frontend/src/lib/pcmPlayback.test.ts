import { describe, expect, it } from "vitest";
import { createPlaybackLevel, playbackFrameLevel } from "./pcmPlayback";

describe("createPlaybackLevel", () => {
  it("keeps speak gain across the next enqueue after duck is not called", () => {
    const level = createPlaybackLevel(1, 0.25);
    expect(level.target()).toBe(1);
  });

  it("stays ducked until restore or flush", () => {
    const level = createPlaybackLevel(1, 0.25);
    expect(level.duck()).toBe(0.25);
    expect(level.target()).toBe(0.25);
    expect(level.target()).toBe(0.25);
    expect(level.restore()).toBe(1);
    expect(level.target()).toBe(1);
  });

  it("scales frame energy by the current playback gain", () => {
    const loud = new Float32Array([1, -1, 1, -1]);
    expect(playbackFrameLevel(loud, 1)).toBe(1);
    expect(playbackFrameLevel(loud, 0.25)).toBe(0.25);
    expect(playbackFrameLevel(new Float32Array(), 1)).toBe(0);
  });

  it("returns silence on flush and speaks at full gain after", () => {
    const level = createPlaybackLevel(1, 0.25);
    level.duck();
    expect(level.afterFlush()).toBe(0);
    expect(level.target()).toBe(1);
  });
});
