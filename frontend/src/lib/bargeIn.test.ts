import { describe, expect, it, vi } from "vitest";
import { createVoiceBargeIn } from "./bargeIn";

describe("createVoiceBargeIn", () => {
  it("does not duck or flush when the agent is silent", () => {
    const bargeIn = createVoiceBargeIn();
    const duck = vi.fn();
    const flush = vi.fn();
    bargeIn.onUserInterim(duck);
    bargeIn.onUserStarted(flush);
    expect(duck).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("ducks on interim while the agent is speaking without dropping audio", () => {
    const bargeIn = createVoiceBargeIn();
    const duck = vi.fn();
    expect(bargeIn.acceptBinary()).toBe(true);
    bargeIn.onUserInterim(duck);
    expect(duck).toHaveBeenCalledTimes(1);
    expect(bargeIn.acceptBinary()).toBe(true);
  });

  it("flushes only on user started and then drops the rest of that utterance", () => {
    const bargeIn = createVoiceBargeIn();
    const duck = vi.fn();
    const flush = vi.fn();
    bargeIn.acceptBinary();
    bargeIn.onUserInterim(duck);
    bargeIn.onUserStarted(flush);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(bargeIn.acceptBinary()).toBe(false);
    bargeIn.onUserInterim(duck);
    bargeIn.onUserStarted(flush);
    expect(duck).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("stops agent audio from the stop control even mid-utterance", () => {
    const bargeIn = createVoiceBargeIn();
    const flush = vi.fn();
    bargeIn.acceptBinary();
    bargeIn.stopAgentAudio(flush);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(bargeIn.acceptBinary()).toBe(false);
  });

  it("keeps dropping after a stop until the next agent turn", () => {
    const bargeIn = createVoiceBargeIn();
    bargeIn.acceptBinary();
    bargeIn.stopAgentAudio(() => undefined);
    bargeIn.onAgentAudioDone();
    expect(bargeIn.acceptBinary()).toBe(false);
    bargeIn.onAgentThinking();
    expect(bargeIn.acceptBinary()).toBe(true);
  });

  it("clears the drop when a new agent turn starts", () => {
    const bargeIn = createVoiceBargeIn();
    bargeIn.acceptBinary();
    bargeIn.onUserStarted(() => undefined);
    expect(bargeIn.acceptBinary()).toBe(false);
    bargeIn.onAgentThinking();
    expect(bargeIn.acceptBinary()).toBe(true);
  });
});
