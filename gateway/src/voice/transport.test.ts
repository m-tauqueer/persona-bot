import { describe, expect, it } from "vitest";
import { resolveVoiceSitting } from "./transport.js";

const keys = {
  ttsKey: "tts_voice",
  fishKey: "fish_voice",
  providerKey: "voice_provider",
  auraValue: "aura",
  fishValue: "fish",
  auraFallback: "aura-2-luna-en",
  missingVoiceCode: "fish_voice_missing",
  providerCode: "voice_provider",
};

describe("resolveVoiceSitting", () => {
  it("uses Aura when the provider is empty even if a Fish id is stored", () => {
    expect(
      resolveVoiceSitting(
        { tts_voice: "aura-2-thalia-en", fish_voice: "fish-ref-1" },
        keys,
      ),
    ).toEqual({ kind: "aura", speakModel: "aura-2-thalia-en" });
  });

  it("uses Aura when the provider is the configured Aura value", () => {
    expect(
      resolveVoiceSitting(
        {
          tts_voice: "aura-2-thalia-en",
          fish_voice: "fish-ref-1",
          voice_provider: "aura",
        },
        keys,
      ),
    ).toEqual({ kind: "aura", speakModel: "aura-2-thalia-en" });
  });

  it("uses Fish only when provider and id are both set", () => {
    expect(
      resolveVoiceSitting(
        {
          tts_voice: "aura-2-thalia-en",
          fish_voice: "fish-ref-1",
          voice_provider: "fish",
        },
        keys,
      ),
    ).toEqual({ kind: "fish", voiceId: "fish-ref-1" });
  });

  it("fails closed when provider is Fish but the Fish id is empty", () => {
    expect(
      resolveVoiceSitting(
        { voice_provider: "fish", tts_voice: "aura-2-thalia-en" },
        keys,
      ),
    ).toEqual({ kind: "error", code: "fish_voice_missing" });
  });

  it("fails closed on a provider that is not a configured choice", () => {
    expect(
      resolveVoiceSitting(
        { voice_provider: "other", fish_voice: "fish-ref-1" },
        keys,
      ),
    ).toEqual({ kind: "error", code: "voice_provider" });
  });
});
