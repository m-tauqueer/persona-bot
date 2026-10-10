import type { FastifyBaseLogger } from "fastify";
import WebSocket from "ws";
import { type GatewayConfig, deepgramAuthHeaderValue } from "../config.js";

export type AgentJsonHandler = (message: Record<string, unknown>) => void;
export type AgentBinaryHandler = (chunk: Buffer) => void;

export class DeepgramAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepgramAgentError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function messageType(message: Record<string, unknown>): string | null {
  const type = message.type;
  return typeof type === "string" ? type : null;
}

export function socketDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function deepgramEventText(message: Record<string, unknown>): string {
  const description = message.description;
  if (typeof description === "string" && description.length > 0) {
    return description;
  }
  const code = message.code;
  if (typeof code === "string" && code.length > 0) {
    return code;
  }
  return "deepgram error";
}

export class DeepgramVoiceAgent {
  private readonly socket: WebSocket;
  private readonly config: GatewayConfig;
  private readonly log: FastifyBaseLogger;
  private jsonHandlers = new Set<AgentJsonHandler>();
  private binaryHandlers = new Set<AgentBinaryHandler>();
  private closeHandlers = new Set<() => void>();
  private receivedJson: Record<string, unknown>[] = [];
  private closed = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  private constructor(
    socket: WebSocket,
    config: GatewayConfig,
    log: FastifyBaseLogger,
  ) {
    this.socket = socket;
    this.config = config;
    this.log = log;
    socket.on("message", (data, isBinary) => {
      this.dispatch(data, isBinary);
    });
    socket.on("error", (error) => {
      this.log.error({ err: error }, "deepgram agent socket error");
    });
    socket.on("close", () => {
      this.closed = true;
      this.stopKeepAlive();
      for (const handler of this.closeHandlers) {
        handler();
      }
    });
  }

  static connect(
    config: GatewayConfig,
    log: FastifyBaseLogger,
  ): Promise<DeepgramVoiceAgent> {
    if (!config.DEEPGRAM_API_KEY) {
      return Promise.reject(
        new DeepgramAgentError("DEEPGRAM_API_KEY is not set"),
      );
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(config.DEEPGRAM_AGENT_WSS_URL, {
        headers: {
          [config.DEEPGRAM_AGENT_AUTH_HEADER]: deepgramAuthHeaderValue(config),
        },
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new DeepgramAgentError("Deepgram connect timed out"));
      }, config.DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new DeepgramVoiceAgent(socket, config, log));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(
          new DeepgramAgentError(
            error instanceof Error ? error.message : "Deepgram connect failed",
          ),
        );
      });
    });
  }

  get ready(): boolean {
    return this.socket.readyState === WebSocket.OPEN && !this.closed;
  }

  onJson(handler: AgentJsonHandler): () => void {
    this.jsonHandlers.add(handler);
    return () => {
      this.jsonHandlers.delete(handler);
    };
  }

  onBinary(handler: AgentBinaryHandler): () => void {
    this.binaryHandlers.add(handler);
    return () => {
      this.binaryHandlers.delete(handler);
    };
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  waitForType(
    type: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ready) {
        reject(new DeepgramAgentError("Deepgram socket is not open"));
        return;
      }
      let settled = false;
      let offJson = () => {};
      let offClose = () => {};
      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        offJson();
        offClose();
        fn();
      };
      const take = (message: Record<string, unknown>): boolean => {
        const incoming = messageType(message);
        if (incoming === this.config.DEEPGRAM_MSG_ERROR) {
          finish(() => {
            reject(new DeepgramAgentError(deepgramEventText(message)));
          });
          return true;
        }
        if (incoming === type) {
          finish(() => {
            resolve(message);
          });
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        finish(() => {
          reject(new DeepgramAgentError(`timed out waiting for ${type}`));
        });
      }, timeoutMs);
      for (const message of this.receivedJson) {
        if (take(message)) {
          return;
        }
      }
      offClose = this.onClose(() => {
        finish(() => {
          reject(new DeepgramAgentError("Deepgram socket closed"));
        });
      });
      offJson = this.onJson((message) => {
        take(message);
      });
    });
  }

  startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.ready) {
        this.stopKeepAlive();
        return;
      }
      try {
        this.sendJson({ type: this.config.DEEPGRAM_MSG_KEEP_ALIVE });
      } catch (error) {
        this.log.warn({ err: error }, "deepgram keepalive failed");
        this.stopKeepAlive();
      }
    }, this.config.DEEPGRAM_KEEP_ALIVE_INTERVAL_MS);
    this.keepAliveTimer.unref();
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  sendJson(payload: Record<string, unknown>): void {
    if (!this.ready) {
      throw new DeepgramAgentError("Deepgram socket is not open");
    }
    this.socket.send(JSON.stringify(payload));
  }

  sendBinary(chunk: Buffer): void {
    if (!this.ready) {
      throw new DeepgramAgentError("Deepgram socket is not open");
    }
    this.socket.send(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopKeepAlive();
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }

  private dispatch(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) {
      const chunk = socketDataToBuffer(data);
      for (const handler of this.binaryHandlers) {
        handler(chunk);
      }
      return;
    }
    const text = socketDataToBuffer(data).toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.log.warn("deepgram sent non-json text");
      return;
    }
    const message = asRecord(parsed);
    if (!message) {
      return;
    }
    const type = messageType(message);
    if (type === this.config.DEEPGRAM_MSG_WARNING) {
      this.log.warn({ event: message }, "deepgram warning");
    }
    if (type === this.config.DEEPGRAM_MSG_ERROR) {
      this.log.error({ event: message }, "deepgram error");
    }
    this.receivedJson.push(message);
    for (const handler of this.jsonHandlers) {
      handler(message);
    }
  }
}

export function reconnectBackoffMs(config: GatewayConfig): number {
  return config.DEEPGRAM_RECONNECT_BACKOFF_MS;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function openVoiceAgentSession(
  config: GatewayConfig,
  log: FastifyBaseLogger,
  settings: Record<string, unknown>,
): Promise<{ agent: DeepgramVoiceAgent; requestId: string | null }> {
  const agent = await DeepgramVoiceAgent.connect(config, log);
  try {
    const timeout = config.DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS;
    const welcome = await agent.waitForType(
      config.DEEPGRAM_MSG_WELCOME,
      timeout,
    );
    const requestId =
      typeof welcome.request_id === "string" ? welcome.request_id : null;
    agent.sendJson(settings);
    await agent.waitForType(config.DEEPGRAM_MSG_SETTINGS_APPLIED, timeout);
    agent.startKeepAlive();
    return { agent, requestId };
  } catch (error) {
    agent.close();
    throw error;
  }
}

export async function reconnectVoiceAgentSession(
  config: GatewayConfig,
  log: FastifyBaseLogger,
  settings: Record<string, unknown>,
): Promise<{ agent: DeepgramVoiceAgent; requestId: string | null }> {
  const delay = reconnectBackoffMs(config);
  if (delay > 0) {
    await sleep(delay);
  }
  return openVoiceAgentSession(config, log, settings);
}

export async function openVoiceAgentSessionWithRetry(
  config: GatewayConfig,
  log: FastifyBaseLogger,
  settings: Record<string, unknown>,
): Promise<{ agent: DeepgramVoiceAgent; requestId: string | null }> {
  try {
    return await openVoiceAgentSession(config, log, settings);
  } catch (first) {
    let last = first;
    for (
      let attempt = 1;
      attempt <= config.DEEPGRAM_RECONNECT_ATTEMPTS;
      attempt += 1
    ) {
      log.warn({ attempt, err: last }, "deepgram connect retry");
      try {
        return await reconnectVoiceAgentSession(config, log, settings);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }
}
