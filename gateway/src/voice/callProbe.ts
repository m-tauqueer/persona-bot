/**
 * Drives a whole voice call the way the browser does: it opens the client
 * WebSocket with a real session cookie and streams paced PCM frames for the
 * entire call, speech and silence alike.
 *
 * The speech is synthesised through Deepgram's speak API, so the transport
 * runs its own speech recognition on real audio. That is what makes this
 * probe able to check transcription and interruption, which an injected text
 * message cannot exercise.
 */
import WebSocket from "ws";
import { persistAuthSession, signSessionCookieValue } from "../auth/session.js";
import { createPostgres, createRedis } from "../clients.js";
import {
  type GatewayConfig,
  clientVoiceWsUrl,
  loadGatewayConfig,
  voiceAudioPersistEnabled,
  voiceAudioReady,
  voiceCallReady,
} from "../config.js";
import { socketDataToBuffer } from "../deepgram/agent.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function synthesise(
  config: GatewayConfig,
  text: string,
): Promise<Buffer> {
  const base = config.DEEPGRAM_API_BASE_URL ?? "https://api.deepgram.com";
  const url = new URL(config.DEEPGRAM_SPEAK_PATH, base);
  url.searchParams.set("model", config.DEEPGRAM_TTS_VOICE as string);
  url.searchParams.set("encoding", config.DEEPGRAM_AUDIO_INPUT_ENCODING);
  url.searchParams.set(
    "sample_rate",
    String(config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE),
  );
  url.searchParams.set("container", config.DEEPGRAM_AUDIO_OUTPUT_CONTAINER);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      [config.DEEPGRAM_AGENT_AUTH_HEADER]: `${config.DEEPGRAM_AGENT_AUTH_SCHEME} ${config.DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`speak API ${response.status}: ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Streams frames at wall-clock pace, exactly like a live microphone. */
class MicPacer {
  private readonly frameBytes: number;
  private readonly silence: Buffer;
  private queue: Buffer = Buffer.alloc(0);
  private timer: NodeJS.Timeout | null = null;
  private sentSpeechFrames = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly config: GatewayConfig,
  ) {
    const samples = Math.round(
      (config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE * config.VOICE_PROBE_FRAME_MS) /
        1000,
    );
    this.frameBytes = samples * (config.VOICE_AUDIO_BITS_PER_SAMPLE / 8);
    this.silence = Buffer.alloc(this.frameBytes);
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (this.queue.length >= this.frameBytes) {
        this.socket.send(this.queue.subarray(0, this.frameBytes));
        this.queue = this.queue.subarray(this.frameBytes);
        this.sentSpeechFrames += 1;
        return;
      }
      this.socket.send(this.silence);
    }, this.config.VOICE_PROBE_FRAME_MS);
  }

  /** Queue speech and resolve once the last frame of it has gone out. */
  speak(pcm: Buffer): Promise<void> {
    this.queue = Buffer.concat([this.queue, pcm]);
    const frames = Math.ceil(pcm.length / this.frameBytes);
    return new Promise((resolve) => {
      setTimeout(resolve, (frames + 2) * this.config.VOICE_PROBE_FRAME_MS);
    });
  }

  get spoken(): number {
    return this.sentSpeechFrames;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const config = loadGatewayConfig();
  const readyError = voiceCallReady(config);
  if (readyError) {
    console.error(`FAIL: ${readyError}`);
    return 1;
  }

  const firstLine = config.VOICE_CALL_PROBE_FIRST_TEXT;
  const secondLine = config.VOICE_CALL_PROBE_INTERRUPT_TEXT;
  console.log(`speaking_1=${JSON.stringify(firstLine)}`);
  console.log(`speaking_2=${JSON.stringify(secondLine)}`);
  const [speechOne, speechTwo] = await Promise.all([
    synthesise(config, firstLine),
    synthesise(config, secondLine),
  ]);
  const bytesPerMs =
    (config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE *
      (config.VOICE_AUDIO_BITS_PER_SAMPLE / 8)) /
    1000;
  console.log(
    `speech_1=${speechOne.length}B (${Math.round(speechOne.length / bytesPerMs)}ms) ` +
      `speech_2=${speechTwo.length}B (${Math.round(speechTwo.length / bytesPerMs)}ms)`,
  );

  const sql = createPostgres(config);
  const redis = createRedis(config);
  let socket: WebSocket | null = null;
  let pacer: MicPacer | null = null;
  let sessionId: string | null = null;

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

    const transcripts: { role: string; content: string }[] = [];
    const events: string[] = [];
    let agentBytes = 0;
    let lastAgentByteAt = 0;
    let userStartedCount = 0;
    let audioDoneCount = 0;

    socket = new WebSocket(clientVoiceWsUrl(config, persona.id), {
      headers: { Cookie: cookie },
    });
    const client = socket;

    sessionId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for the call to be ready"));
      }, config.DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS);
      client.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      client.on("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        res.resume();
        reject(new Error(`connect HTTP ${res.statusCode ?? 0}`));
      });
      client.on("message", (data, isBinary) => {
        if (isBinary) {
          agentBytes += socketDataToBuffer(data).length;
          lastAgentByteAt = Date.now();
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
          if (eventType === config.DEEPGRAM_MSG_USER_STARTED) {
            userStartedCount += 1;
          }
          if (eventType === config.DEEPGRAM_MSG_AGENT_AUDIO_DONE) {
            audioDoneCount += 1;
          }
          if (eventType === config.DEEPGRAM_MSG_CONVERSATION_TEXT && event) {
            const role = typeof event.role === "string" ? event.role : "";
            const content =
              typeof event.content === "string" ? event.content : "";
            if (content) {
              transcripts.push({ role, content });
              console.log(`heard[${role}]=${JSON.stringify(content)}`);
            }
          }
          return;
        }
        if (message.type === config.VOICE_CLIENT_READY_TYPE) {
          clearTimeout(timer);
          resolve(String(message.session_id));
        }
      });
    });
    console.log(`session_id=${sessionId}`);

    pacer = new MicPacer(client, config);
    pacer.start();

    // --- the caller speaks, the persona answers ---
    const spokeAt = Date.now();
    await pacer.speak(speechOne);
    const heardBy = Date.now();

    const firstAudio = await new Promise<number>((resolve) => {
      const deadline = Date.now() + config.VOICE_INJECT_TIMEOUT_MS;
      const poll = setInterval(() => {
        if (agentBytes > 0) {
          clearInterval(poll);
          resolve(Date.now());
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          resolve(0);
        }
      }, 50);
    });
    check("reply_heard", firstAudio > 0, `${agentBytes} bytes of agent audio`);
    if (firstAudio > 0) {
      console.log(
        `time_to_first_word=${firstAudio - heardBy}ms (from end of speech), ` +
          `${firstAudio - spokeAt}ms (from start of speech)`,
      );
    }
    const userSaid = transcripts.filter(
      (line) => line.role === config.VOICE_TRANSCRIPT_USER_ROLE,
    );
    check(
      "speech_transcribed",
      userSaid.length > 0,
      userSaid[0] ? JSON.stringify(userSaid[0].content) : "nothing transcribed",
    );

    // --- the caller talks over the reply ---
    let interruptChecked = false;
    if (firstAudio > 0) {
      await wait(config.VOICE_CALL_PROBE_INTERRUPT_DELAY_MS);
      if (audioDoneCount === 0) {
        const beforeInterrupt = agentBytes;
        const startedBefore = userStartedCount;
        await pacer.speak(speechTwo);
        await wait(config.VOICE_CALL_PROBE_SILENCE_WINDOW_MS);
        const afterInterrupt = agentBytes;
        const quietFor = Date.now() - lastAgentByteAt;
        check(
          "interrupt_detected",
          userStartedCount > startedBefore,
          `user-started events: ${startedBefore} -> ${userStartedCount}`,
        );
        check(
          "playback_stopped",
          quietFor >= config.VOICE_CALL_PROBE_SILENCE_WINDOW_MS / 2,
          `no agent audio for ${quietFor}ms (bytes ${beforeInterrupt} -> ${afterInterrupt})`,
        );
        interruptChecked = true;

        // The call must recover: the next turn is still heard.
        const resumed = await new Promise<boolean>((resolve) => {
          const mark = agentBytes;
          const deadline = Date.now() + config.VOICE_INJECT_TIMEOUT_MS;
          const poll = setInterval(() => {
            if (agentBytes > mark + config.VOICE_CALL_PROBE_RESUME_BYTES) {
              clearInterval(poll);
              resolve(true);
            } else if (Date.now() > deadline) {
              clearInterval(poll);
              resolve(false);
            }
          }, 100);
        });
        check("call_recovers_after_interrupt", resumed);
      } else {
        console.log("interrupt=SKIP (the reply finished before we could talk)");
      }
    }
    if (!interruptChecked) {
      console.log("interrupt=SKIP");
    }

    await wait(config.VOICE_PROBE_SETTLE_MS);
    pacer.stop();
    client.close();
    socket = null;
    await wait(config.VOICE_PROBE_SETTLE_MS);

    // --- the record it left behind ---
    const turns = await sql<
      {
        ordinal: number;
        speaker: string;
        text: string;
        stt: string | null;
        tts_interrupted: boolean | null;
      }[]
    >`
      SELECT ordinal, speaker, text,
             stt_meta->>'transcript' AS stt,
             (tts_meta->>'interrupted')::boolean AS tts_interrupted
      FROM turns WHERE session_id = ${sessionId} ORDER BY ordinal
    `;
    for (const turn of turns) {
      console.log(
        `row ordinal=${turn.ordinal} speaker=${turn.speaker} ` +
          `text=${JSON.stringify(turn.text.slice(0, 60))} ` +
          `stt=${turn.stt ? JSON.stringify(turn.stt.slice(0, 60)) : "null"} ` +
          `interrupted=${turn.tts_interrupted}`,
      );
    }
    check("turns_recorded", turns.length >= 2, `${turns.length} turns`);
    check(
      "transcript_persisted",
      turns.some((turn) => turn.speaker === "user" && Boolean(turn.stt)),
    );

    const spans = await sql<
      { ordinal: number; stt_ms: number | null; brain_ms: number | null }[]
    >`
      SELECT t.ordinal, ls.stt_ms, ls.brain_ms
      FROM latency_spans ls INNER JOIN turns t ON t.id = ls.turn_id
      WHERE t.session_id = ${sessionId} ORDER BY t.ordinal
    `;
    for (const span of spans) {
      console.log(
        `span ordinal=${span.ordinal} stt_ms=${span.stt_ms} brain_ms=${span.brain_ms}`,
      );
    }
    check(
      "speech_recognition_timed",
      spans.some((span) => span.stt_ms !== null),
      "stt_ms is only reported for real speech",
    );

    const assets = await sql<{ direction: string; duration_ms: number }[]>`
      SELECT a.direction, a.duration_ms
      FROM audio_assets a INNER JOIN turns t ON t.id = a.turn_id
      WHERE t.session_id = ${sessionId} ORDER BY t.ordinal
    `;
    for (const asset of assets) {
      console.log(
        `audio direction=${asset.direction} duration_ms=${asset.duration_ms}`,
      );
    }
    if (!voiceAudioPersistEnabled(config) || voiceAudioReady(config)) {
      console.log("audio_assets=SKIP (blob storage not configured)");
    } else {
      const directions = new Set(assets.map((asset) => asset.direction));
      check(
        "both_sides_stored",
        directions.has("user") && directions.has("bot"),
        [...directions].join(","),
      );
    }

    const [closed] = await sql<{ ended_at: Date | null }[]>`
      SELECT ended_at FROM sessions WHERE id = ${sessionId}
    `;
    check("call_closed", Boolean(closed?.ended_at));
  } catch (error) {
    console.error(
      `FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    failed += 1;
  } finally {
    pacer?.stop();
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

process.exit(await main());
