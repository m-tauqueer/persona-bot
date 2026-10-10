import { resolveSpeakModel } from "../personas.js";

export type VoiceSitting =
  | { kind: "aura"; speakModel: string | undefined }
  | { kind: "fish"; voiceId: string }
  | { kind: "error"; code: string };

function configString(
  voiceConfig: Record<string, unknown>,
  key: string,
): string {
  const raw = voiceConfig[key];
  return typeof raw === "string" ? raw.trim() : "";
}

export function resolveVoiceSitting(
  voiceConfig: Record<string, unknown>,
  keys: {
    ttsKey: string;
    fishKey: string;
    providerKey: string;
    auraValue: string;
    fishValue: string;
    auraFallback: string | undefined;
    missingVoiceCode: string;
    providerCode: string;
  },
): VoiceSitting {
  const provider = configString(voiceConfig, keys.providerKey);
  const fishId = configString(voiceConfig, keys.fishKey);
  const speakModel = resolveSpeakModel(
    voiceConfig,
    keys.ttsKey,
    keys.auraFallback,
  );
  if (!provider || provider === keys.auraValue) {
    return { kind: "aura", speakModel };
  }
  if (provider === keys.fishValue) {
    if (!fishId) {
      return { kind: "error", code: keys.missingVoiceCode };
    }
    return { kind: "fish", voiceId: fishId };
  }
  return { kind: "error", code: keys.providerCode };
}
