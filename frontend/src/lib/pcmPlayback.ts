import { int16LeToFloat, rmsLevel } from "./pcm";
import type { VoiceClientConfig } from "./voiceConfig";

export type PcmPlayback = {
  enqueue: (bytes: ArrayBuffer) => void;
  duck: () => void;
  restore: () => void;
  flush: () => boolean;
  stop: () => Promise<void>;
  level: () => number;
};

export function playbackFrameLevel(samples: Float32Array, gain: number): number {
  if (gain <= 0 || samples.length === 0) {
    return 0;
  }
  return Math.min(1, rmsLevel(samples) * gain);
}

type ScheduledSource = {
  source: AudioBufferSourceNode;
  startAt: number;
};

export type PlaybackLevel = {
  target: () => number;
  duck: () => number;
  restore: () => number;
  afterFlush: () => number;
};

/** Speak/duck/flush levels. Flush is always silence; the next enqueue uses speak gain. */
export function createPlaybackLevel(
  speakGain: number,
  duckGain: number,
): PlaybackLevel {
  let target = speakGain;
  return {
    target() {
      return target;
    },
    duck() {
      target = duckGain;
      return target;
    },
    restore() {
      target = speakGain;
      return target;
    },
    afterFlush() {
      target = speakGain;
      return 0;
    },
  };
}

export function createPcmPlayback(config: VoiceClientConfig): PcmPlayback {
  const context = new AudioContext({ sampleRate: config.outputSampleRate });
  const output = context.createGain();
  output.connect(context.destination);
  const level = createPlaybackLevel(
    config.playbackSpeakGain,
    config.playbackDuckGain,
  );
  const sources = new Set<ScheduledSource>();
  let nextTime = 0;
  let stopped = false;
  let outputLevel = 0;

  function setOutputGain(value: number) {
    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(value, now);
  }

  function silenceAndDrop(): boolean {
    const now = context.currentTime;
    const hadAudio = sources.size > 0 || nextTime > now;
    outputLevel = 0;
    setOutputGain(level.afterFlush());
    for (const item of sources) {
      try {
        item.source.stop(item.startAt > now ? item.startAt : now);
      } catch {
        // already stopped
      }
      item.source.disconnect();
    }
    sources.clear();
    nextTime = now;
    return hadAudio;
  }

  return {
    enqueue(bytes: ArrayBuffer) {
      if (stopped || bytes.byteLength < 2) {
        return;
      }
      const samples = int16LeToFloat(bytes);
      if (samples.length === 0) {
        return;
      }
      outputLevel = playbackFrameLevel(samples, level.target());
      if (context.state === "suspended") {
        void context.resume();
      }
      setOutputGain(level.target());
      const buffer = context.createBuffer(
        config.channelCount,
        samples.length,
        config.outputSampleRate,
      );
      for (let channel = 0; channel < config.channelCount; channel += 1) {
        buffer.getChannelData(channel).set(samples);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      const now = context.currentTime;
      const startAt = Math.max(nextTime, now);
      source.start(startAt);
      const item: ScheduledSource = { source, startAt };
      sources.add(item);
      source.onended = () => {
        sources.delete(item);
        if (sources.size === 0) {
          outputLevel = 0;
        }
      };
      nextTime = startAt + buffer.duration;
    },
    duck() {
      if (stopped) {
        return;
      }
      setOutputGain(level.duck());
    },
    restore() {
      if (stopped) {
        return;
      }
      setOutputGain(level.restore());
    },
    flush() {
      if (stopped) {
        return false;
      }
      return silenceAndDrop();
    },
    level() {
      return outputLevel;
    },
    async stop() {
      stopped = true;
      silenceAndDrop();
      if (context.state !== "closed") {
        await context.close();
      }
    },
  };
}
