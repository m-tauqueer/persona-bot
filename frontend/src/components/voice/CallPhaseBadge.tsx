import { ThinkingOrb } from "thinking-orbs";
import { orbStateForPhase, phaseLabel, type CallPhase } from "../../lib/callPhase";
import type { UiCopy } from "../../lib/uiCopy";
import type { VoiceClientConfig } from "../../lib/voiceConfig";

export function CallPhaseBadge({
  phase,
  copy,
  config,
}: {
  phase: CallPhase;
  copy: UiCopy;
  config: VoiceClientConfig;
}) {
  const state = orbStateForPhase(phase, config);
  if (!state) {
    return null;
  }
  const label = phaseLabel(phase, copy);
  return (
    <div className="voice-sit__badge">
      <ThinkingOrb
        state={state}
        size={config.orbSize}
        theme={config.orbTheme}
        aria-label={label}
      />
      <span>{label}</span>
    </div>
  );
}