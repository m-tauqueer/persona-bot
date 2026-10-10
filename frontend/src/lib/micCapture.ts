import { floatToInt16Le, resampleLinear, rmsLevel, SampleAccumulator } from "./pcm";
import type { VoiceClientConfig } from "./voiceConfig";

export type MicCapture = {
  stop: () => Promise<void>;
};

function captureWorkletSource(name: string): string {
  return `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(name)}, VoiceCaptureProcessor);
`;
}

function micDenied(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return error.name === "NotAllowedError" || error.name === "PermissionDeniedError";
}

export async function startMicCapture(
  config: VoiceClientConfig,
  handlers: {
    onFrame: (frame: ArrayBuffer) => void;
    onLevel?: (level: number) => void;
  },
): Promise<MicCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot capture a microphone");
  }
  if (typeof AudioWorkletNode === "undefined") {
    throw new Error("This browser cannot stream microphone PCM");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: config.channelCount,
        sampleRate: config.inputSampleRate,
        echoCancellation: config.echoCancellation,
        noiseSuppression: config.noiseSuppression,
        autoGainControl: config.autoGainControl,
      },
    });
  } catch (error) {
    if (micDenied(error)) {
      throw new Error("Microphone permission was denied");
    }
    throw error instanceof Error ? error : new Error("Microphone is unavailable");
  }

  const context = new AudioContext({ sampleRate: config.inputSampleRate });
  const workletUrl = URL.createObjectURL(
    new Blob([captureWorkletSource(config.workletName)], {
      type: "application/javascript",
    }),
  );
  const frames = new SampleAccumulator(config.captureFrameSamples);
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;

  try {
    await context.audioWorklet.addModule(workletUrl);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, config.workletName);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const raw = event.data;
      if (!(raw instanceof Float32Array) || raw.length === 0) {
        return;
      }
      handlers.onLevel?.(rmsLevel(raw));
      const resampled = resampleLinear(
        raw,
        context.sampleRate,
        config.inputSampleRate,
      );
      for (const frame of frames.push(resampled)) {
        handlers.onFrame(floatToInt16Le(frame));
      }
    };
    source.connect(node);
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch (error) {
    URL.revokeObjectURL(workletUrl);
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    await context.close().catch(() => undefined);
    throw error instanceof Error ? error : new Error("Microphone capture failed");
  }

  return {
    async stop() {
      node?.port.close();
      node?.disconnect();
      source?.disconnect();
      frames.reset();
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      URL.revokeObjectURL(workletUrl);
      if (context.state !== "closed") {
        await context.close();
      }
    },
  };
}
