import { describe, expect, it } from "vitest";
import { testConfig } from "../test/config.js";
import { buildVoiceAgentSettings } from "./settings.js";

const identity = {
  appUserId: "11111111-1111-1111-1111-111111111111",
  engramUserId: "eng-user",
  personaId: "22222222-2222-2222-2222-222222222222",
  sessionId: "33333333-3333-3333-3333-333333333333",
};

describe("voice agent settings", () => {
  it("speaks with the persona voice id when one is set", () => {
    const config = testConfig({
      BYO_LLM_PUBLIC_URL: "https://example.ngrok-free.app",
      DEEPGRAM_TTS_VOICE: "aura-2-luna-en",
    });
    const settings = buildVoiceAgentSettings(
      config,
      identity,
      "aura-2-thalia-en",
    );
    const agent = settings.agent as {
      speak: { provider: { model?: string } };
    };
    expect(agent.speak.provider.model).toBe("aura-2-thalia-en");
  });

  it("falls back to the env voice when the persona has none", () => {
    const config = testConfig({
      BYO_LLM_PUBLIC_URL: "https://example.ngrok-free.app",
      DEEPGRAM_TTS_VOICE: "aura-2-luna-en",
    });
    const settings = buildVoiceAgentSettings(
      config,
      identity,
      config.DEEPGRAM_TTS_VOICE,
    );
    const agent = settings.agent as {
      speak: { provider: { model?: string } };
    };
    expect(agent.speak.provider.model).toBe("aura-2-luna-en");
  });

  it("speaks the Aura id even when a fish id is also on the persona", () => {
    const config = testConfig({
      BYO_LLM_PUBLIC_URL: "https://example.ngrok-free.app",
      DEEPGRAM_TTS_VOICE: "aura-2-luna-en",
    });
    const settings = buildVoiceAgentSettings(
      config,
      identity,
      "aura-2-thalia-en",
    );
    const agent = settings.agent as {
      speak: { provider: { model?: string } };
    };
    expect(agent.speak.provider.model).toBe("aura-2-thalia-en");
    expect(JSON.stringify(settings)).not.toContain("fish-ref-1");
  });
});
