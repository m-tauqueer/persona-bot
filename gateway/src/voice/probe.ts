import WebSocket from "ws";
import { persistAuthSession, signSessionCookieValue } from "../auth/session.js";
import { createPostgres, createRedis } from "../clients.js";
import {
  clientVoiceWsUrl,
  loadGatewayConfig,
  thinkEndpointUrl,
  voiceAudioPersistEnabled,
  voiceAudioReady,
  voiceCallReady,
  voiceTunnelCommand,
} from "../config.js";
import { socketDataToBuffer } from "../deepgram/agent.js";
import { SESSION_CHANNEL } from "../schema.js";
import { readVoiceCallState } from "./callState.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function expectUnauthorized(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        socket.terminate();
        reject(new Error("unauth connect timed out"));
      });
    }, timeoutMs);
    socket.on("unexpected-response", (_req, res) => {
      finish(() => {
        const status = res.statusCode ?? 0;
        res.resume();
        resolve(status);
      });
    });
    socket.on("open", () => {
      finish(() => {
        socket.close();
        reject(new Error("voice socket opened without a session cookie"));
      });
    });
    socket.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });
  });
}

async function main(): Promise<number> {
  const config = loadGatewayConfig();
  const readyError = voiceCallReady(config);
  console.log(`tunnel_command=${voiceTunnelCommand(config)}`);
  console.log(`byo_llm_public_url=${config.BYO_LLM_PUBLIC_URL ?? ""}`);
  if (readyError) {
    console.error(`FAIL: ${readyError}`);
    return 1;
  }
  if (!config.VOICE_INJECT_TEXT) {
    console.error("FAIL: VOICE_INJECT_TEXT is not set");
    return 1;
  }
  const thinkUrl = thinkEndpointUrl(config);
  const publicBase = (config.BYO_LLM_PUBLIC_URL ?? "").replace(/\/$/, "");
  console.log(`think_endpoint_url=${thinkUrl}`);
  if (!publicBase || !thinkUrl.startsWith(publicBase)) {
    console.error("FAIL: think endpoint is not built from BYO_LLM_PUBLIC_URL");
    return 1;
  }

  const voiceUrl = clientVoiceWsUrl(config);
  let failed = 0;
  try {
    const unauthStatus = await expectUnauthorized(
      voiceUrl,
      config.DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS,
    );
    if (unauthStatus !== 401) {
      console.error(`unauth status=${unauthStatus} FAIL`);
      failed += 1;
    } else {
      console.log("unauth=401 ok");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`unauth FAIL ${detail}`);
    failed += 1;
  }

  const sql = createPostgres(config);
  const redis = createRedis(config);
  let socket: WebSocket | null = null;
  try {
    const users = await sql<
      { id: string; email: string }[]
    >`SELECT id, email FROM users ORDER BY created_at LIMIT 1`;
    const user = users[0];
    if (!user) {
      console.error("FAIL: no app user in the database");
      return 1;
    }
    const authSessionId = await persistAuthSession(redis, config, user.id);
    const cookie = `${config.SESSION_COOKIE_NAME}=${signSessionCookieValue(config, authSessionId)}`;
    console.log(`user=${user.email}`);
    const [persona] = await sql<{ id: string }[]>`
      SELECT id FROM personas WHERE published = true ORDER BY created_at LIMIT 1
    `;
    if (!persona) {
      console.error("FAIL: no published persona recorded locally");
      return 1;
    }
    const authedUrl = clientVoiceWsUrl(config, persona.id);

    const opened = await new Promise<{
      socket: WebSocket;
      sessionId: string;
      requestId: string | null;
    }>((resolve, reject) => {
      const client = new WebSocket(authedUrl, { headers: { Cookie: cookie } });
      const timer = setTimeout(() => {
        client.terminate();
        reject(new Error("timed out waiting for voice ready"));
      }, config.DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS);
      client.on("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        const status = res.statusCode ?? 0;
        res.resume();
        reject(new Error(`authed connect HTTP ${status}`));
      });
      client.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      client.on("message", (data, isBinary) => {
        if (isBinary) {
          return;
        }
        const message = asRecord(
          JSON.parse(socketDataToBuffer(data).toString("utf8")) as unknown,
        );
        if (!message) {
          return;
        }
        if (message.type === config.VOICE_CLIENT_ERROR_TYPE) {
          clearTimeout(timer);
          reject(new Error(`voice error: ${JSON.stringify(message)}`));
          return;
        }
        if (message.type !== config.VOICE_CLIENT_READY_TYPE) {
          return;
        }
        const sessionId =
          typeof message.session_id === "string" ? message.session_id : null;
        if (!sessionId) {
          clearTimeout(timer);
          reject(new Error("voice ready missing session_id"));
          return;
        }
        clearTimeout(timer);
        resolve({
          socket: client,
          sessionId,
          requestId:
            typeof message.request_id === "string" ? message.request_id : null,
        });
      });
    });
    socket = opened.socket;
    console.log(`session_id=${opened.sessionId}`);
    console.log(`request_id=${opened.requestId ?? ""}`);

    const call = await readVoiceCallState(redis, config, opened.sessionId);
    if (!call || call.session_id !== opened.sessionId) {
      console.error("redis_call_state=FAIL");
      failed += 1;
    } else {
      console.log(
        `redis_call_state=ok request_id=${call.request_id ?? ""} barge_in=${call.barge_in}`,
      );
    }

    const sessions = await sql<
      { channel: string }[]
    >`SELECT channel FROM sessions WHERE id = ${opened.sessionId}`;
    const channel = sessions[0]?.channel;
    if (channel !== SESSION_CHANNEL.VOICE) {
      console.error(`session_channel=${channel ?? "missing"} FAIL`);
      failed += 1;
    } else {
      console.log("session_channel=voice ok");
    }

    const audio = await new Promise<{ bytes: number; events: string[] }>(
      (resolve, reject) => {
        const events: string[] = [];
        const turnStart = Date.now();
        const at = () => `+${Date.now() - turnStart}ms`;
        let bytes = 0;
        let settle: NodeJS.Timeout | null = null;
        let silenceTimer: NodeJS.Timeout | null = null;
        const timer = setTimeout(() => {
          if (silenceTimer) {
            clearInterval(silenceTimer);
            silenceTimer = null;
          }
          if (bytes > 0) {
            // Audio arrived but the turn never reported done; take what we have.
            resolve({ bytes, events });
            return;
          }
          reject(
            new Error(
              `timed out waiting for spoken audio events=${events.join(",")}`,
            ),
          );
        }, config.VOICE_INJECT_TIMEOUT_MS);
        const finish = () => {
          clearTimeout(timer);
          if (settle) {
            clearTimeout(settle);
          }
          if (silenceTimer) {
            clearInterval(silenceTimer);
            silenceTimer = null;
          }
          resolve({ bytes, events });
        };
        socket?.on("message", (data, isBinary) => {
          if (isBinary) {
            if (bytes === 0) {
              console.log(`first_agent_audio ${at()}`);
            }
            bytes += socketDataToBuffer(data).length;
            return;
          }
          const message = asRecord(
            JSON.parse(socketDataToBuffer(data).toString("utf8")) as unknown,
          );
          if (!message) {
            return;
          }
          if (message.type === config.VOICE_CLIENT_ERROR_TYPE) {
            clearTimeout(timer);
            reject(new Error(`voice error: ${JSON.stringify(message)}`));
            return;
          }
          if (message.type === config.VOICE_CLIENT_WARNING_TYPE) {
            console.log(`warning=${JSON.stringify(message.event ?? message)}`);
            return;
          }
          if (message.type === config.VOICE_CLIENT_AGENT_EVENT_TYPE) {
            const event = asRecord(message.event);
            const eventType =
              event && typeof event.type === "string" ? event.type : "unknown";
            events.push(eventType);
            console.log(`agent_event=${eventType} ${at()}`);
            if (eventType === config.DEEPGRAM_MSG_LATENCY_REPORT) {
              console.log(`latency_report=${JSON.stringify(event)}`);
            }
            if (eventType === config.DEEPGRAM_MSG_CONVERSATION_TEXT) {
              console.log(`conversation_text=${JSON.stringify(event)}`);
            }
            if (eventType === config.DEEPGRAM_MSG_AGENT_AUDIO_DONE) {
              // Let the transport's latency report and our writes land.
              if (settle) {
                clearTimeout(settle);
              }
              settle = setTimeout(finish, config.VOICE_PROBE_SETTLE_MS);
            }
          }
        });
        socket?.on("close", () => {
          clearTimeout(timer);
          if (silenceTimer) {
            clearInterval(silenceTimer);
            silenceTimer = null;
          }
          reject(
            new Error(`socket closed before audio events=${events.join(",")}`),
          );
        });
        socket?.send(
          JSON.stringify({
            type: config.DEEPGRAM_MSG_INJECT_USER,
            content: config.VOICE_INJECT_TEXT,
          }),
        );
        console.log(`inject=sent ${at()}`);
        // A browser streams mic audio continuously, silence included. Without
        // it the transport closes the call for lack of input.
        const frameSamples = Math.round(
          (config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE *
            config.VOICE_PROBE_FRAME_MS) /
            1000,
        );
        const silence = Buffer.alloc(frameSamples * 2);
        silenceTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(silence);
          }
        }, config.VOICE_PROBE_FRAME_MS);
      },
    );
    console.log(`audio_bytes=${audio.bytes}`);

    const turns = await sql<
      {
        ordinal: number;
        speaker: string;
        controller_action: string | null;
        has_stt: boolean;
        has_tts: boolean;
      }[]
    >`
      SELECT ordinal, speaker, controller_action,
             stt_meta IS NOT NULL AS has_stt,
             tts_meta IS NOT NULL AS has_tts
      FROM turns
      WHERE session_id = ${opened.sessionId}
      ORDER BY ordinal
    `;
    for (const row of turns) {
      console.log(
        `row ordinal=${row.ordinal} speaker=${row.speaker} ` +
          `action=${row.controller_action} stt_meta=${row.has_stt} ` +
          `tts_meta=${row.has_tts}`,
      );
    }
    if (turns.length < 2) {
      console.error(
        "FAIL: expected persisted user and persona turns on the voice session",
      );
      failed += 1;
    }
    if (!turns.some((row) => row.speaker === "user" && row.has_stt)) {
      console.error("FAIL: no stt_meta recorded on a user turn");
      failed += 1;
    } else {
      console.log("stt_meta=ok");
    }
    if (!turns.some((row) => row.speaker === "persona" && row.has_tts)) {
      console.error("FAIL: no tts_meta recorded on a persona turn");
      failed += 1;
    } else {
      console.log("tts_meta=ok");
    }

    const spans = await sql<
      {
        ordinal: number;
        stt_ms: number | null;
        brain_ms: number | null;
        reframe_ms: number | null;
        reframe_first_token_ms: number | null;
        tts_first_byte_ms: number | null;
        total_ms: number | null;
        transport: unknown;
      }[]
    >`
      SELECT t.ordinal, ls.stt_ms, ls.brain_ms, ls.reframe_ms,
             ls.reframe_first_token_ms, ls.tts_first_byte_ms, ls.total_ms,
             ls.transport_latency AS transport
      FROM latency_spans ls
      INNER JOIN turns t ON t.id = ls.turn_id
      WHERE t.session_id = ${opened.sessionId}
      ORDER BY t.ordinal
    `;
    for (const span of spans) {
      console.log(
        `span ordinal=${span.ordinal} stt_ms=${span.stt_ms} ` +
          `brain_ms=${span.brain_ms} reframe_ms=${span.reframe_ms} ` +
          `reframe_first_token_ms=${span.reframe_first_token_ms} ` +
          `tts_first_byte_ms=${span.tts_first_byte_ms} ` +
          `total_ms=${span.total_ms} ` +
          `transport=${JSON.stringify(span.transport)}`,
      );
    }
    if (spans.length === 0) {
      console.error("FAIL: no latency spans recorded");
      failed += 1;
    }
    if (!spans.some((span) => span.transport !== null)) {
      console.error("FAIL: no transport latency report recorded");
      failed += 1;
    } else {
      console.log("transport_latency=ok");
    }

    const assets = await sql<
      {
        direction: string;
        blob_url: string;
        duration_ms: number | null;
        size_bytes: string | null;
      }[]
    >`
      SELECT a.direction, a.blob_url, a.duration_ms, a.size_bytes
      FROM audio_assets a
      INNER JOIN turns t ON t.id = a.turn_id
      WHERE t.session_id = ${opened.sessionId}
      ORDER BY t.ordinal
    `;
    for (const asset of assets) {
      console.log(
        `audio direction=${asset.direction} duration_ms=${asset.duration_ms} ` +
          `size_bytes=${asset.size_bytes} url=${asset.blob_url}`,
      );
    }
    const audioError = voiceAudioReady(config);
    if (!voiceAudioPersistEnabled(config)) {
      console.log("audio_assets=SKIP (VOICE_AUDIO_PERSIST_ENABLED=false)");
    } else if (audioError) {
      console.log(`audio_assets=SKIP (${audioError})`);
    } else {
      const directions = new Set(assets.map((asset) => asset.direction));
      if (!directions.has("user") || !directions.has("bot")) {
        console.error(
          `FAIL: expected user and bot audio, got [${[...directions].join(",")}]`,
        );
        failed += 1;
      } else {
        console.log("audio_assets=ok");
      }
    }

    socket.close();
    socket = null;
    await new Promise((resolve) =>
      setTimeout(resolve, config.VOICE_PROBE_SETTLE_MS),
    );
    const closed = await sql<{ ended_at: Date | null }[]>`
      SELECT ended_at FROM sessions WHERE id = ${opened.sessionId}
    `;
    if (!closed[0]?.ended_at) {
      console.error("FAIL: voice session was not closed");
      failed += 1;
    } else {
      console.log("session_ended_at=ok");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${detail}`);
    failed += 1;
  } finally {
    socket?.close();
    await redis.quit();
    await sql.end({ timeout: 5 });
  }

  if (failed) {
    console.error(`FAIL: ${failed} check(s)`);
    return 1;
  }
  console.log("PROBE_OK");
  return 0;
}

const code = await main();
process.exit(code);
