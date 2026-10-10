import { describe, expect, it } from "vitest";
import { testConfig } from "../test/config.js";
import {
  decodeFishEvent,
  encodeFishEvent,
  fishAudioBytes,
  mapFishHttpStatus,
} from "./live.js";

describe("Fish live events", () => {
  const config = testConfig();

  it("round-trips start and text events", () => {
    const encoded = encodeFishEvent({
      event: config.FISH_WS_EVENT_START,
      request: { text: "", reference_id: "abc" },
    });
    expect(decodeFishEvent(encoded)).toEqual({
      event: config.FISH_WS_EVENT_START,
      request: { text: "", reference_id: "abc" },
    });
  });

  it("reads pcm bytes from an audio event", () => {
    const pcm = Uint8Array.from([1, 2, 3, 4]);
    const encoded = encodeFishEvent({
      event: config.FISH_WS_EVENT_AUDIO,
      audio: pcm,
    });
    const decoded = decodeFishEvent(encoded);
    expect(decoded?.event).toBe(config.FISH_WS_EVENT_AUDIO);
    expect(fishAudioBytes(decoded ?? {})?.equals(Buffer.from(pcm))).toBe(true);
  });

  it("encodes stop as the stream-end event", () => {
    expect(
      decodeFishEvent(encodeFishEvent({ event: config.FISH_WS_EVENT_STOP })),
    ).toEqual({ event: config.FISH_WS_EVENT_STOP });
  });

  it("maps 401 and 402 without falling through to Aura", () => {
    expect(mapFishHttpStatus(401, config)).toBe(
      config.FAILURE_CODE_FISH_UNAUTHORIZED,
    );
    expect(mapFishHttpStatus(402, config)).toBe(
      config.FAILURE_CODE_FISH_PAYMENT,
    );
    expect(mapFishHttpStatus(500, config)).toBe(config.FAILURE_CODE_FISH);
  });
});
