export type VoiceBargeIn = {
  acceptBinary: () => boolean;
  onUserStarted: () => boolean;
  onAgentThinking: () => void;
  onAgentAudioDone: () => void;
};

/**
 * Drops agent audio from the moment the user interrupts until that utterance
 * is over. A new agent turn always clears the drop, so an interrupted
 * utterance that never reports its end cannot mute the rest of the call.
 */
export function createVoiceBargeIn(): VoiceBargeIn {
  let agentAudioOpen = false;
  let dropping = false;

  const reset = () => {
    agentAudioOpen = false;
    dropping = false;
  };

  return {
    acceptBinary() {
      if (dropping) {
        return false;
      }
      agentAudioOpen = true;
      return true;
    },
    onUserStarted() {
      if (!agentAudioOpen || dropping) {
        return false;
      }
      dropping = true;
      return true;
    },
    onAgentThinking: reset,
    onAgentAudioDone: reset,
  };
}

export type SpeechHold = {
  since: number | null;
};

export function emptySpeechHold(): SpeechHold {
  return { since: null };
}

/**
 * Decide whether the user has held the floor long enough for the persona to
 * stop talking. Words alone start the clock; the persona goes quiet once they
 * keep coming past `holdMs`. Deliberately not the first word and not a VAD
 * click - both fire while the speaker is only clearing their throat, and the
 * mic hears the persona too. Thinking is a separate trigger (speech_final or
 * UtteranceEnd), so stopping early never takes the floor mid-sentence.
 */
export function applySpeechHold(
  hold: SpeechHold,
  now: number,
  holdMs: number,
): { hold: SpeechHold; stop: boolean } {
  if (hold.since === null) {
    return { hold: { since: now }, stop: false };
  }
  if (now - hold.since >= holdMs) {
    return { hold: emptySpeechHold(), stop: true };
  }
  return { hold, stop: false };
}
