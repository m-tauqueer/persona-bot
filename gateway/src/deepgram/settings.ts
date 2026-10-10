import {
  type GatewayConfig,
  thinkEndpointHeaders,
  thinkEndpointUrl,
} from "../config.js";

export type ThinkIdentity = {
  appUserId: string;
  engramUserId: string;
  personaId: string;
  sessionId: string;
};

export function buildVoiceAgentSettings(
  config: GatewayConfig,
  identity: ThinkIdentity,
  speakModel: string | undefined,
): Record<string, unknown> {
  const think: Record<string, unknown> = {
    provider: {
      type: config.DEEPGRAM_THINK_PROVIDER_TYPE,
      model: config.DEEPGRAM_THINK_MODEL,
    },
    endpoint: {
      url: thinkEndpointUrl(config),
      headers: thinkEndpointHeaders(config, identity),
    },
  };
  if (config.DEEPGRAM_THINK_PROMPT) {
    think.prompt = config.DEEPGRAM_THINK_PROMPT;
  }

  const agent: Record<string, unknown> = {
    listen: {
      provider: {
        type: config.DEEPGRAM_LISTEN_PROVIDER_TYPE,
        version: config.DEEPGRAM_LISTEN_PROVIDER_VERSION,
        model: config.DEEPGRAM_STT_MODEL,
        language: config.DEEPGRAM_STT_LANGUAGE,
      },
    },
    think,
    speak: {
      provider: {
        type: config.DEEPGRAM_SPEAK_PROVIDER_TYPE,
        version: config.DEEPGRAM_SPEAK_PROVIDER_VERSION,
        model: speakModel,
      },
    },
  };
  if (config.DEEPGRAM_AGENT_GREETING) {
    agent.greeting = config.DEEPGRAM_AGENT_GREETING;
  }

  return {
    type: config.DEEPGRAM_MSG_SETTINGS,
    audio: {
      input: {
        encoding: config.DEEPGRAM_AUDIO_INPUT_ENCODING,
        sample_rate: config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE,
      },
      output: {
        encoding: config.DEEPGRAM_AUDIO_OUTPUT_ENCODING,
        sample_rate: config.DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE,
        container: config.DEEPGRAM_AUDIO_OUTPUT_CONTAINER,
      },
    },
    agent,
  };
}
