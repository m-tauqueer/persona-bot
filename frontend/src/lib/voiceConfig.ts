import type { OrbSize, OrbState, OrbTheme } from "thinking-orbs";
import { requiredViteBool, requiredViteFloat, requiredViteGain, requiredViteInt, requiredViteOneOf } from "./env";
import { VOICE_ORB_STATES, VOICE_ORB_THEMES, type CallPhase } from "./callPhase";
import { gatewayOrigin } from "./gateway";
import { parseCallPhases } from "./swarmHear";

function requiredString(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function requiredPositiveInt(name: string, value: string | undefined): number {
  const parsed = Number(requiredString(name, value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requiredBool(name: string, value: string | undefined): boolean {
  const raw = requiredString(name, value);
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

export type VoiceClientConfig = {
  wsUrl: string;
  personaIdQuery: string;
  inputEncoding: string;
  inputSampleRate: number;
  outputEncoding: string;
  outputSampleRate: number;
  channelCount: number;
  captureFrameSamples: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  workletName: string;
  readyType: string;
  errorType: string;
  warningType: string;
  agentEventType: string;
  conversationTextType: string;
  userStartedType: string;
  thinkingType: string;
  audioDoneType: string;
  transcriptUserRole: string;
  transcriptAssistantRole: string;
  vuBarCount: number;
  thinkingCueEnabled: boolean;
  thinkingCueUrl: string;
  thinkingCueLoop: boolean;
  thinkingCueIntervalMs: number;
  thinkingCueMaxMs: number;
  thinkingCueLabel: string;
  playbackSpeakGain: number;
  playbackDuckGain: number;
  reconnectingCode: string;
  reconnectedCode: string;
  connectionDropped: string;
  ringIdleAmplitude: number;
  ringActiveMin: number;
  ringActiveMax: number;
  ringSmoothing: number;
  ringButtonPx: number;
  ringButtonScale: number;
  orbSize: OrbSize;
  orbTheme: OrbTheme;
  orbConnecting: OrbState;
  orbListening: OrbState;
  orbThinking: OrbState;
  orbSpeaking: OrbState;
  orbReconnecting: OrbState;
  avatarSize: number;
  avatarGrid: number;
  avatarHueSpread: number;
  avatarAnimated: boolean;
  swarmCount: number;
  swarmHearingPhases: ReadonlySet<CallPhase>;
  swarmHearTauMs: number;
  swarmDtCapMs: number;
  swarmRadiusCalm: number;
  swarmRadiusHear: number;
  swarmSpeedCalm: number;
  swarmSpeedHear: number;
  swarmNoiseCalm: number;
  swarmNoiseHear: number;
  swarmPointCalm: number;
  swarmPointHear: number;
  swarmHueCalm: number;
  swarmHueHear: number;
  swarmSatCalm: number;
  swarmSatHear: number;
  swarmLightCalm: number;
  swarmLightHear: number;
  swarmPerspective: number;
  swarmLevelNoise: number;
  swarmWarpCalm: number;
  swarmWarpHear: number;
  swarmCoupling: number;
  swarmSwirl: number;
  swarmHitRatio: number;
  swarmDockGapPx: number;
  swarmRespectReducedMotion: boolean;
  stopSpeakPhases: ReadonlySet<CallPhase>;
  transcriptWidthPx: number;
  transcriptAvatarSize: number;
};

export function loadVoiceClientConfig(): VoiceClientConfig {
  const path = requiredString(
    "VITE_VOICE_WS_PATH",
    import.meta.env.VITE_VOICE_WS_PATH,
  );
  if (!path.startsWith("/")) {
    throw new Error("VITE_VOICE_WS_PATH must start with /");
  }
  const origin = new URL(gatewayOrigin());
  const ws = new URL(path, origin);
  ws.protocol = origin.protocol === "https:" ? "wss:" : "ws:";

  const loaded: VoiceClientConfig = {
    wsUrl: ws.toString(),
    personaIdQuery: requiredString(
      "VITE_PERSONA_ID_QUERY",
      import.meta.env.VITE_PERSONA_ID_QUERY,
    ),
    inputEncoding: requiredString(
      "VITE_DEEPGRAM_AUDIO_INPUT_ENCODING",
      import.meta.env.VITE_DEEPGRAM_AUDIO_INPUT_ENCODING,
    ),
    inputSampleRate: requiredPositiveInt(
      "VITE_DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE",
      import.meta.env.VITE_DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE,
    ),
    outputEncoding: requiredString(
      "VITE_DEEPGRAM_AUDIO_OUTPUT_ENCODING",
      import.meta.env.VITE_DEEPGRAM_AUDIO_OUTPUT_ENCODING,
    ),
    outputSampleRate: requiredPositiveInt(
      "VITE_DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE",
      import.meta.env.VITE_DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE,
    ),
    channelCount: requiredPositiveInt(
      "VITE_VOICE_CHANNEL_COUNT",
      import.meta.env.VITE_VOICE_CHANNEL_COUNT,
    ),
    captureFrameSamples: requiredPositiveInt(
      "VITE_VOICE_CAPTURE_FRAME_SAMPLES",
      import.meta.env.VITE_VOICE_CAPTURE_FRAME_SAMPLES,
    ),
    echoCancellation: requiredBool(
      "VITE_VOICE_ECHO_CANCELLATION",
      import.meta.env.VITE_VOICE_ECHO_CANCELLATION,
    ),
    noiseSuppression: requiredBool(
      "VITE_VOICE_NOISE_SUPPRESSION",
      import.meta.env.VITE_VOICE_NOISE_SUPPRESSION,
    ),
    autoGainControl: requiredBool(
      "VITE_VOICE_AUTO_GAIN_CONTROL",
      import.meta.env.VITE_VOICE_AUTO_GAIN_CONTROL,
    ),
    workletName: requiredString(
      "VITE_VOICE_WORKLET_NAME",
      import.meta.env.VITE_VOICE_WORKLET_NAME,
    ),
    readyType: requiredString(
      "VITE_VOICE_CLIENT_READY_TYPE",
      import.meta.env.VITE_VOICE_CLIENT_READY_TYPE,
    ),
    errorType: requiredString(
      "VITE_VOICE_CLIENT_ERROR_TYPE",
      import.meta.env.VITE_VOICE_CLIENT_ERROR_TYPE,
    ),
    warningType: requiredString(
      "VITE_VOICE_CLIENT_WARNING_TYPE",
      import.meta.env.VITE_VOICE_CLIENT_WARNING_TYPE,
    ),
    agentEventType: requiredString(
      "VITE_VOICE_CLIENT_AGENT_EVENT_TYPE",
      import.meta.env.VITE_VOICE_CLIENT_AGENT_EVENT_TYPE,
    ),
    conversationTextType: requiredString(
      "VITE_DEEPGRAM_MSG_CONVERSATION_TEXT",
      import.meta.env.VITE_DEEPGRAM_MSG_CONVERSATION_TEXT,
    ),
    userStartedType: requiredString(
      "VITE_DEEPGRAM_MSG_USER_STARTED",
      import.meta.env.VITE_DEEPGRAM_MSG_USER_STARTED,
    ),
    thinkingType: requiredString(
      "VITE_DEEPGRAM_MSG_AGENT_THINKING",
      import.meta.env.VITE_DEEPGRAM_MSG_AGENT_THINKING,
    ),
    audioDoneType: requiredString(
      "VITE_DEEPGRAM_MSG_AGENT_AUDIO_DONE",
      import.meta.env.VITE_DEEPGRAM_MSG_AGENT_AUDIO_DONE,
    ),
    transcriptUserRole: requiredString(
      "VITE_VOICE_TRANSCRIPT_USER_ROLE",
      import.meta.env.VITE_VOICE_TRANSCRIPT_USER_ROLE,
    ),
    transcriptAssistantRole: requiredString(
      "VITE_VOICE_TRANSCRIPT_ASSISTANT_ROLE",
      import.meta.env.VITE_VOICE_TRANSCRIPT_ASSISTANT_ROLE,
    ),
    vuBarCount: requiredPositiveInt(
      "VITE_VOICE_VU_BAR_COUNT",
      import.meta.env.VITE_VOICE_VU_BAR_COUNT,
    ),
    thinkingCueEnabled: requiredBool(
      "VITE_VOICE_THINKING_CUE_ENABLED",
      import.meta.env.VITE_VOICE_THINKING_CUE_ENABLED,
    ),
    thinkingCueUrl: requiredString(
      "VITE_VOICE_THINKING_CUE_URL",
      import.meta.env.VITE_VOICE_THINKING_CUE_URL,
    ),
    thinkingCueLoop: requiredBool(
      "VITE_VOICE_THINKING_CUE_LOOP",
      import.meta.env.VITE_VOICE_THINKING_CUE_LOOP,
    ),
    thinkingCueIntervalMs: requiredPositiveInt(
      "VITE_VOICE_THINKING_CUE_INTERVAL_MS",
      import.meta.env.VITE_VOICE_THINKING_CUE_INTERVAL_MS,
    ),
    thinkingCueMaxMs: requiredPositiveInt(
      "VITE_VOICE_THINKING_CUE_MAX_MS",
      import.meta.env.VITE_VOICE_THINKING_CUE_MAX_MS,
    ),
    thinkingCueLabel: requiredString(
      "VITE_VOICE_THINKING_CUE_LABEL",
      import.meta.env.VITE_VOICE_THINKING_CUE_LABEL,
    ),
    playbackSpeakGain: requiredViteGain("VITE_VOICE_PLAYBACK_SPEAK_GAIN"),
    playbackDuckGain: requiredViteGain("VITE_VOICE_PLAYBACK_DUCK_GAIN"),
    reconnectingCode: requiredString(
      "VITE_FAILURE_CODE_RECONNECTING",
      import.meta.env.VITE_FAILURE_CODE_RECONNECTING,
    ),
    reconnectedCode: requiredString(
      "VITE_FAILURE_CODE_RECONNECTED",
      import.meta.env.VITE_FAILURE_CODE_RECONNECTED,
    ),
    connectionDropped: requiredString(
      "VITE_VOICE_CONNECTION_DROPPED",
      import.meta.env.VITE_VOICE_CONNECTION_DROPPED,
    ),
    ringIdleAmplitude: requiredViteFloat("VITE_VOICE_RING_IDLE_AMPLITUDE", 0, 1.2),
    ringActiveMin: requiredViteFloat("VITE_VOICE_RING_ACTIVE_MIN", 0, 1.2),
    ringActiveMax: requiredViteFloat("VITE_VOICE_RING_ACTIVE_MAX", 0, 1.2),
    ringSmoothing: requiredViteFloat("VITE_VOICE_RING_SMOOTHING", 0, 1),
    ringButtonPx: requiredViteInt("VITE_VOICE_RING_BUTTON_PX"),
    ringButtonScale: requiredViteFloat("VITE_VOICE_RING_BUTTON_SCALE", 0, 1),
    orbSize: requiredOrbSize("VITE_VOICE_ORB_SIZE"),
    orbTheme: requiredViteOneOf("VITE_VOICE_ORB_THEME", VOICE_ORB_THEMES),
    orbConnecting: requiredViteOneOf("VITE_VOICE_ORB_CONNECTING", VOICE_ORB_STATES),
    orbListening: requiredViteOneOf("VITE_VOICE_ORB_LISTENING", VOICE_ORB_STATES),
    orbThinking: requiredViteOneOf("VITE_VOICE_ORB_THINKING", VOICE_ORB_STATES),
    orbSpeaking: requiredViteOneOf("VITE_VOICE_ORB_SPEAKING", VOICE_ORB_STATES),
    orbReconnecting: requiredViteOneOf(
      "VITE_VOICE_ORB_RECONNECTING",
      VOICE_ORB_STATES,
    ),
    avatarSize: requiredViteInt("VITE_VOICE_AVATAR_SIZE"),
    avatarGrid: requiredViteInt("VITE_VOICE_AVATAR_GRID"),
    avatarHueSpread: requiredViteFloat("VITE_VOICE_AVATAR_HUE_SPREAD", 0, 180),
    avatarAnimated: requiredViteBool("VITE_VOICE_AVATAR_ANIMATED"),
    swarmCount: requiredViteInt("VITE_VOICE_SWARM_COUNT"),
    swarmHearingPhases: parseCallPhases(
      requiredString(
        "VITE_VOICE_SWARM_HEARING_PHASES",
        import.meta.env.VITE_VOICE_SWARM_HEARING_PHASES,
      ),
      "VITE_VOICE_SWARM_HEARING_PHASES",
    ),
    swarmHearTauMs: requiredViteFloat("VITE_VOICE_SWARM_HEAR_TAU_MS", 1, 20000),
    swarmDtCapMs: requiredViteFloat("VITE_VOICE_SWARM_DT_CAP_MS", 1, 250),
    swarmRadiusCalm: requiredViteFloat("VITE_VOICE_SWARM_RADIUS_CALM", 0, 2),
    swarmRadiusHear: requiredViteFloat("VITE_VOICE_SWARM_RADIUS_HEAR", 0, 2),
    swarmSpeedCalm: requiredViteFloat("VITE_VOICE_SWARM_SPEED_CALM", 0, 8),
    swarmSpeedHear: requiredViteFloat("VITE_VOICE_SWARM_SPEED_HEAR", 0, 8),
    swarmNoiseCalm: requiredViteFloat("VITE_VOICE_SWARM_NOISE_CALM", 0, 2),
    swarmNoiseHear: requiredViteFloat("VITE_VOICE_SWARM_NOISE_HEAR", 0, 2),
    swarmPointCalm: requiredViteFloat("VITE_VOICE_SWARM_POINT_CALM", 0.5, 16),
    swarmPointHear: requiredViteFloat("VITE_VOICE_SWARM_POINT_HEAR", 0.5, 16),
    swarmHueCalm: requiredViteFloat("VITE_VOICE_SWARM_HUE_CALM", 0, 1),
    swarmHueHear: requiredViteFloat("VITE_VOICE_SWARM_HUE_HEAR", 0, 1),
    swarmSatCalm: requiredViteFloat("VITE_VOICE_SWARM_SAT_CALM", 0, 1),
    swarmSatHear: requiredViteFloat("VITE_VOICE_SWARM_SAT_HEAR", 0, 1),
    swarmLightCalm: requiredViteFloat("VITE_VOICE_SWARM_LIGHT_CALM", 0, 1),
    swarmLightHear: requiredViteFloat("VITE_VOICE_SWARM_LIGHT_HEAR", 0, 1),
    swarmPerspective: requiredViteFloat("VITE_VOICE_SWARM_PERSPECTIVE", 0.2, 8),
    swarmLevelNoise: requiredViteFloat("VITE_VOICE_SWARM_LEVEL_NOISE", 0, 2),
    swarmWarpCalm: requiredViteFloat("VITE_VOICE_SWARM_WARP_CALM", 0, 8),
    swarmWarpHear: requiredViteFloat("VITE_VOICE_SWARM_WARP_HEAR", 0, 8),
    swarmCoupling: requiredViteFloat("VITE_VOICE_SWARM_COUPLING", 0, 2),
    swarmSwirl: requiredViteFloat("VITE_VOICE_SWARM_SWIRL", 0, 2),
    swarmHitRatio: requiredViteFloat("VITE_VOICE_SWARM_HIT_RATIO", 0.1, 1),
    swarmDockGapPx: requiredViteInt("VITE_VOICE_DOCK_GAP_PX"),
    swarmRespectReducedMotion: requiredViteBool(
      "VITE_VOICE_SWARM_RESPECT_REDUCED_MOTION",
    ),
    stopSpeakPhases: parseCallPhases(
      requiredString(
        "VITE_VOICE_STOP_SPEAK_PHASES",
        import.meta.env.VITE_VOICE_STOP_SPEAK_PHASES,
      ),
      "VITE_VOICE_STOP_SPEAK_PHASES",
    ),
    transcriptWidthPx: requiredViteInt("VITE_VOICE_TRANSCRIPT_WIDTH_PX"),
    transcriptAvatarSize: requiredViteInt("VITE_VOICE_TRANSCRIPT_AVATAR_SIZE"),
  };

  if (loaded.ringActiveMin > loaded.ringActiveMax) {
    throw new Error(
      "VITE_VOICE_RING_ACTIVE_MIN must be at most VITE_VOICE_RING_ACTIVE_MAX",
    );
  }
  if (loaded.swarmCount > 50000) {
    throw new Error("VITE_VOICE_SWARM_COUNT must be at most 50000");
  }
  return loaded;
}

function requiredOrbSize(name: keyof ImportMetaEnv): OrbSize {
  const parsed = requiredViteInt(name);
  if (parsed === 20 || parsed === 64) {
    return parsed;
  }
  throw new Error(`${name} must be 20 or 64`);
}

export function voiceSocketUrl(
  config: VoiceClientConfig,
  personaId: string,
): string {
  const url = new URL(config.wsUrl);
  url.searchParams.set(config.personaIdQuery, personaId);
  return url.toString();
}
