import { describe, expect, it } from "vitest";
import { applySpeechHold, emptySpeechHold } from "./bargeIn.js";

describe("applySpeechHold", () => {
  it("never stops on the first words", () => {
    const first = applySpeechHold(emptySpeechHold(), 1_000, 500);
    expect(first.stop).toBe(false);
    expect(first.hold.since).toBe(1_000);
  });

  it("keeps the persona talking while speech is still short", () => {
    const started = applySpeechHold(emptySpeechHold(), 1_000, 500).hold;
    expect(applySpeechHold(started, 1_400, 500).stop).toBe(false);
  });

  it("stops the persona once speech is sustained past the hold", () => {
    const started = applySpeechHold(emptySpeechHold(), 1_000, 500).hold;
    const sustained = applySpeechHold(started, 1_500, 500);
    expect(sustained.stop).toBe(true);
    expect(sustained.hold.since).toBeNull();
  });

  it("rearms after a stop so the next utterance gets its own hold", () => {
    const started = applySpeechHold(emptySpeechHold(), 1_000, 500).hold;
    const stopped = applySpeechHold(started, 1_500, 500);
    const again = applySpeechHold(stopped.hold, 9_000, 500);
    expect(again.stop).toBe(false);
    expect(again.hold.since).toBe(9_000);
  });

  it("honours a longer hold when the room echoes", () => {
    const started = applySpeechHold(emptySpeechHold(), 0, 1_500).hold;
    expect(applySpeechHold(started, 1_000, 1_500).stop).toBe(false);
    expect(applySpeechHold(started, 1_600, 1_500).stop).toBe(true);
  });
});
