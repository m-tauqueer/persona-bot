import { decode, encode } from "@msgpack/msgpack";
import WebSocket from "ws";
import { type GatewayConfig, fishLiveUrl } from "../config.js";
import { socketDataToBuffer } from "../deepgram/agent.js";
import { failureMessage } from "../voice/failures.js";

export class FishLiveError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "FishLiveError";
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function mapFishHttpStatus(
  status: number,
  config: GatewayConfig,
): string {
  if (status === 401) {
    return config.FAILURE_CODE_FISH_UNAUTHORIZED;
  }
  if (status === 402) {
    return config.FAILURE_CODE_FISH_PAYMENT;
  }
  return config.FAILURE_CODE_FISH;
}

export function encodeFishEvent(payload: Record<string, unknown>): Buffer {
  return Buffer.from(encode(payload));
}

export function decodeFishEvent(raw: Buffer): Record<string, unknown> | null {
  try {
    return asRecord(decode(raw));
  } catch {
    return null;
  }
}

export function fishAudioBytes(
  message: Record<string, unknown>,
): Buffer | null {
  const audio = message.audio;
  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }
  if (typeof audio === "string" && audio.length > 0) {
    return Buffer.from(audio, "base64");
  }
  return null;
}

export class FishLiveTts {
  private readonly socket: WebSocket;
  private readonly config: GatewayConfig;
  private closed = false;
  private sentStop = false;

  private constructor(socket: WebSocket, config: GatewayConfig) {
    this.socket = socket;
    this.config = config;
  }

  static connect(config: GatewayConfig): Promise<FishLiveTts> {
    const key = config.FISH_API_KEY;
    if (!key) {
      return Promise.reject(
        new FishLiveError(
          config.FAILURE_MESSAGE_FISH_KEY_MISSING,
          config.FAILURE_CODE_FISH_KEY_MISSING,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(fishLiveUrl(config), {
        headers: {
          [config.FISH_AUTH_HEADER]: `${config.FISH_AUTH_SCHEME} ${key}`,
          [config.FISH_MODEL_HEADER]: config.FISH_TTS_MODEL,
        },
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(
          new FishLiveError(
            config.FAILURE_MESSAGE_FISH,
            config.FAILURE_CODE_FISH,
          ),
        );
      }, config.FISH_TTS_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        socket.terminate();
        reject(error);
      };
      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new FishLiveTts(socket, config));
      });
      socket.once("error", (error) => {
        fail(
          error instanceof FishLiveError
            ? error
            : new FishLiveError(
                error instanceof Error
                  ? error.message
                  : config.FAILURE_MESSAGE_FISH,
                config.FAILURE_CODE_FISH,
              ),
        );
      });
      socket.once("unexpected-response", (_req, res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        const code = mapFishHttpStatus(status, config);
        fail(new FishLiveError(failureMessage(config, code), code));
      });
    });
  }

  start(referenceId?: string): void {
    const request: Record<string, unknown> = {
      text: "",
      format: this.config.FISH_TTS_FORMAT,
      sample_rate: this.config.FISH_TTS_SAMPLE_RATE,
      latency: this.config.FISH_TTS_LATENCY,
    };
    if (referenceId) {
      request.reference_id = referenceId;
    }
    this.send({
      event: this.config.FISH_WS_EVENT_START,
      request,
    });
  }

  sendText(text: string): void {
    this.send({ event: this.config.FISH_WS_EVENT_TEXT, text });
  }

  flush(): void {
    this.send({ event: this.config.FISH_WS_EVENT_FLUSH });
  }

  stopStream(): void {
    if (this.closed || this.sentStop) {
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN) {
      this.sentStop = true;
      this.send({ event: this.config.FISH_WS_EVENT_STOP });
    }
  }

  hasStopped(): boolean {
    return this.sentStop;
  }

  onMessage(handler: (message: Record<string, unknown>) => void): () => void {
    const listener = (data: WebSocket.RawData) => {
      const decoded = decodeFishEvent(socketDataToBuffer(data));
      if (decoded) {
        handler(decoded);
      }
    };
    this.socket.on("message", listener);
    return () => {
      this.socket.off("message", listener);
    };
  }

  abort(): void {
    this.close();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.socket.readyState === WebSocket.OPEN && !this.sentStop) {
      try {
        this.sentStop = true;
        this.socket.send(
          encodeFishEvent({ event: this.config.FISH_WS_EVENT_STOP }),
        );
      } catch {
        // closing anyway
      }
    }
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeFishEvent(payload));
    }
  }
}
