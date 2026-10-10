import { requiredVite } from "./env";

export function personaPinField(): string {
  return requiredVite("VITE_PERSONA_ID_QUERY");
}

export function personaTtsKey(): string {
  return requiredVite("VITE_PERSONA_VOICE_TTS_KEY");
}

export function personaFishKey(): string {
  return requiredVite("VITE_PERSONA_VOICE_FISH_KEY");
}

export function personaProviderKey(): string {
  return requiredVite("VITE_PERSONA_VOICE_PROVIDER_KEY");
}

export function personaProviderAura(): string {
  return requiredVite("VITE_PERSONA_VOICE_PROVIDER_AURA");
}

export function personaProviderFish(): string {
  return requiredVite("VITE_PERSONA_VOICE_PROVIDER_FISH");
}

export function adminPersonaQuery(id: string): string {
  return `${personaPinField()}=${encodeURIComponent(id)}`;
}

function voiceId(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

export function splitVoiceConfig(
  voice: Record<string, unknown>,
  ttsKey: string,
  fishKey: string,
  providerKey: string,
  auraValue: string,
): {
  ttsVoice: string;
  fishVoice: string;
  provider: string;
  style: Record<string, unknown>;
} {
  const style = { ...voice };
  const ttsRaw = style[ttsKey];
  const fishRaw = style[fishKey];
  const providerRaw = style[providerKey];
  delete style[ttsKey];
  delete style[fishKey];
  delete style[providerKey];
  const provider = voiceId(providerRaw).trim();
  return {
    ttsVoice: voiceId(ttsRaw),
    fishVoice: voiceId(fishRaw),
    provider: provider.length > 0 ? provider : auraValue,
    style,
  };
}

export function mergeVoiceConfig(
  style: Record<string, unknown>,
  ttsVoice: string,
  ttsKey: string,
): Record<string, unknown> {
  const next = { ...style };
  const trimmed = ttsVoice.trim();
  if (trimmed) {
    next[ttsKey] = trimmed;
  } else {
    delete next[ttsKey];
  }
  return next;
}

export function mergePersonaVoices(
  style: Record<string, unknown>,
  ttsVoice: string,
  ttsKey: string,
  fishVoice: string,
  fishKey: string,
  provider: string,
  providerKey: string,
): Record<string, unknown> {
  const next = { ...style };
  delete next[ttsKey];
  delete next[fishKey];
  delete next[providerKey];
  const merged = mergeVoiceConfig(
    mergeVoiceConfig(next, ttsVoice, ttsKey),
    fishVoice,
    fishKey,
  );
  const chosen = provider.trim();
  if (chosen) {
    merged[providerKey] = chosen;
  }
  return merged;
}
