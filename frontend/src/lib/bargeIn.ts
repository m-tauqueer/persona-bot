export type VoiceBargeIn = {
  acceptBinary: () => boolean;
  onUserInterim: (duck: () => void) => void;
  onUserStarted: (flush: () => void) => void;
  stopAgentAudio: (flush: () => void) => void;
  onAgentThinking: () => void;
  onAgentAudioDone: () => void;
  dispose: () => void;
};

/**
 * Mirrors the gateway: while the agent is speaking, interim user text only
 * ducks playback. A committed user start flushes and drops the rest of that
 * utterance. A new agent turn always clears the drop.
 */
export function createVoiceBargeIn(): VoiceBargeIn {
  let agentAudioOpen = false;
  let dropping = false;
  let holdDrop = false;

  const reset = () => {
    agentAudioOpen = false;
    dropping = false;
    holdDrop = false;
  };

  return {
    acceptBinary() {
      if (dropping) {
        return false;
      }
      agentAudioOpen = true;
      return true;
    },
    onUserInterim(duck) {
      if (!agentAudioOpen || dropping) {
        return;
      }
      duck();
    },
    onUserStarted(flush) {
      if (!agentAudioOpen || dropping) {
        return;
      }
      flush();
      dropping = true;
    },
    stopAgentAudio(flush) {
      flush();
      dropping = true;
      holdDrop = true;
    },
    onAgentThinking: reset,
    onAgentAudioDone() {
      agentAudioOpen = false;
      if (!holdDrop) {
        dropping = false;
      }
    },
    dispose: reset,
  };
}
