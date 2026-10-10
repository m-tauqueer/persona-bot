import { describe, expect, it } from "vitest";
import { loadVoiceClientConfig } from "./voiceConfig";

describe("loadVoiceClientConfig", () => {
  it("loads speak and duck gains from env", () => {
    const config = loadVoiceClientConfig();
    expect(config.thinkingCueEnabled).toBe(false);
    expect(config.playbackSpeakGain).toBe(1);
    expect(config.playbackDuckGain).toBe(0.25);
    expect(config.echoCancellation).toBe(false);
    expect(config.noiseSuppression).toBe(false);
    expect(config.autoGainControl).toBe(false);
    expect(config.ringIdleAmplitude).toBe(0.06);
    expect(config.orbListening).toBe("listening");
    expect(config.orbThinking).toBe("working");
    expect(config.orbSpeaking).toBe("composing");
    expect(config.orbSize).toBe(20);
    expect(config.swarmCount).toBe(20000);
    expect(config.swarmHearingPhases.has("listening")).toBe(true);
    expect(config.swarmHearTauMs).toBe(900);
    expect(config.swarmNoiseCalm).toBe(0.016);
    expect(config.swarmNoiseHear).toBe(0.09);
    expect(config.swarmWarpHear).toBe(0.68);
    expect(config.swarmRadiusCalm).toBe(0.52);
    expect(config.swarmHitRatio).toBe(0.66);
    expect(config.swarmDockGapPx).toBe(16);
    expect(config.transcriptWidthPx).toBe(416);
    expect(config.transcriptAvatarSize).toBe(36);
    expect(config.stopSpeakPhases.has("speaking")).toBe(true);
    expect(config.stopSpeakPhases.has("listening")).toBe(true);
  });
});
