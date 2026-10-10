import WebSocket from "ws";
import {
  type GatewayConfig,
  deepgramAuthHeaderValue,
  deepgramListenUrl,
} from "../config.js";
import { DeepgramAgentError, socketDataToBuffer } from "./agent.js";

export type ListenCue =
  | { kind: "speech_started" }
  | { kind: "interim"; text: string }
  | { kind: "final_part"; text: string }
  | { kind: "speech_final"; text: string }
  | { kind: "utterance_end" };

export type ListenTurn = {
  parts: string[];
  draft: string;
  committed: boolean;
};

export function emptyListenTurn(): ListenTurn {
  return { parts: [], draft: "", committed: false };
}

function joinedParts(parts: string[], extra?: string): string {
  const items = extra ? [...parts, extra] : parts;
  return items.join(" ").trim();
}

function commitTurn(
  turn: ListenTurn,
  transcript: string,
): {
  turn: ListenTurn;
  started: boolean;
  preview: string | null;
  transcript: string | null;
} {
  const text = transcript.trim();
  if (!text) {
    return { turn, started: false, preview: null, transcript: null };
  }
  return {
    turn: { parts: [], draft: "", committed: true },
    started: false,
    preview: null,
    transcript: text,
  };
}

/**
 * Assemble one user utterance. Commit on speech_final, or on UtteranceEnd
 * using the last draft if speech_final never arrives (Listen VAD misses
 * silence when the persona is still audible). First commit wins.
 *
 * `committed` is what makes "first commit wins" work, and it is cleared by
 * the arrival of new words - not by SpeechStarted. On a Fish sitting the mic
 * is never quiet (the persona leaks into it), so VAD may never report a fresh
 * silence-to-speech edge, and a reset that waited for one would strand the
 * session in Listening for the rest of the call.
 */
export function applyListenCue(
  turn: ListenTurn,
  cue: ListenCue,
): {
  turn: ListenTurn;
  started: boolean;
  preview: string | null;
  transcript: string | null;
} {
  if (cue.kind === "speech_started") {
    if (turn.committed) {
      return {
        turn: emptyListenTurn(),
        started: true,
        preview: null,
        transcript: null,
      };
    }
    return { turn, started: true, preview: null, transcript: null };
  }
  if (cue.kind === "interim") {
    // Words only reach here with text, so this is a real new utterance.
    const base = turn.committed ? emptyListenTurn() : turn;
    const draft = joinedParts(base.parts, cue.text);
    return {
      turn: { ...base, draft },
      started: false,
      preview: draft,
      transcript: null,
    };
  }
  if (cue.kind === "final_part") {
    const base = turn.committed ? emptyListenTurn() : turn;
    const parts = [...base.parts, cue.text];
    const draft = joinedParts(parts);
    return {
      turn: { ...base, parts, draft },
      started: false,
      preview: draft,
      transcript: null,
    };
  }
  if (turn.committed) {
    return { turn, started: false, preview: null, transcript: null };
  }
  if (cue.kind === "utterance_end") {
    return commitTurn(turn, turn.draft || joinedParts(turn.parts));
  }
  // speech_final carries only the segment that closed the utterance. Anything
  // finalised earlier in the same utterance is in `parts` and must come with it.
  return commitTurn(turn, joinedParts(turn.parts, cue.text) || turn.draft);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function alternativeText(message: Record<string, unknown>): string {
  const channel = asRecord(message.channel);
  const alternatives = channel?.alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return "";
  }
  const first = asRecord(alternatives[0]);
  return typeof first?.transcript === "string" ? first.transcript : "";
}

export function readListenMessage(
  message: Record<string, unknown>,
  config: GatewayConfig,
): ListenCue | null {
  const type = typeof message.type === "string" ? message.type : "";
  if (type === config.DEEPGRAM_LISTEN_MSG_SPEECH_STARTED) {
    return { kind: "speech_started" };
  }
  if (type === config.DEEPGRAM_LISTEN_MSG_UTTERANCE_END) {
    return { kind: "utterance_end" };
  }
  if (type !== config.DEEPGRAM_LISTEN_MSG_RESULTS) {
    return null;
  }
  const text = alternativeText(message).trim();
  const speechFinal = message.speech_final === true;
  const isFinal = message.is_final === true;
  if (speechFinal) {
    return { kind: "speech_final", text };
  }
  if (isFinal && text) {
    return { kind: "final_part", text };
  }
  if (!isFinal && text) {
    return { kind: "interim", text };
  }
  return null;
}

export class DeepgramListen {
  private readonly socket: WebSocket;
  private closed = false;

  private constructor(socket: WebSocket) {
    this.socket = socket;
  }

  static connect(
    config: GatewayConfig,
    timeoutMs: number,
  ): Promise<DeepgramListen> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(deepgramListenUrl(config), {
        headers: {
          [config.DEEPGRAM_AGENT_AUTH_HEADER]: deepgramAuthHeaderValue(config),
        },
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new DeepgramAgentError("listen connect timed out"));
      }, timeoutMs);
      const fail = (error: Error) => {
        clearTimeout(timer);
        socket.terminate();
        reject(error);
      };
      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new DeepgramListen(socket));
      });
      socket.once("error", (error) => {
        fail(
          error instanceof Error
            ? error
            : new DeepgramAgentError("listen connect failed"),
        );
      });
      socket.once("unexpected-response", (_req, res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        fail(new DeepgramAgentError(`listen refused (${status})`));
      });
    });
  }

  onJson(handler: (message: Record<string, unknown>) => void): () => void {
    const listener = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(socketDataToBuffer(data).toString("utf8"));
      } catch {
        return;
      }
      const message = asRecord(parsed);
      if (message) {
        handler(message);
      }
    };
    this.socket.on("message", listener);
    return () => {
      this.socket.off("message", listener);
    };
  }

  onClose(handler: () => void): () => void {
    this.socket.on("close", handler);
    return () => {
      this.socket.off("close", handler);
    };
  }

  sendBinary(frame: Buffer): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }
}
