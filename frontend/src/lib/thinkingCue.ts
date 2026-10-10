import type { VoiceClientConfig } from "./voiceConfig";

export type ThinkingCue = {
  start: () => void;
  stop: () => void;
};

/**
 * Plays the configured cue while the brain works. The wait is long enough that
 * a single blip leaves the caller in silence, so the cue repeats until the
 * agent speaks, the caller interrupts, or the configured ceiling is reached.
 */
export function createThinkingCue(config: VoiceClientConfig): ThinkingCue {
  const audio =
    config.thinkingCueEnabled && typeof Audio !== "undefined"
      ? new Audio(config.thinkingCueUrl)
      : null;
  let repeat: ReturnType<typeof setInterval> | null = null;
  let ceiling: ReturnType<typeof setTimeout> | null = null;

  if (audio) {
    audio.preload = "auto";
  }

  const clearTimers = () => {
    if (repeat !== null) {
      clearInterval(repeat);
      repeat = null;
    }
    if (ceiling !== null) {
      clearTimeout(ceiling);
      ceiling = null;
    }
  };

  const stop = () => {
    clearTimers();
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
  };

  const play = () => {
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  };

  return {
    start() {
      clearTimers();
      if (!audio) {
        return;
      }
      play();
      if (config.thinkingCueLoop) {
        repeat = setInterval(play, config.thinkingCueIntervalMs);
      }
      ceiling = setTimeout(stop, config.thinkingCueMaxMs);
    },
    stop,
  };
}
