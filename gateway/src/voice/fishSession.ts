import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import WebSocket from "ws";
import type { AppUser } from "../auth/types.js";
import { endSitting } from "../chat/closingPass.js";
import {
  type GatewayConfig,
  voiceAudioPersistEnabled,
  voiceAudioReady,
} from "../config.js";
import { socketDataToBuffer } from "../deepgram/agent.js";
import {
  DeepgramListen,
  applyListenCue,
  emptyListenTurn,
  readListenMessage,
} from "../deepgram/listen.js";
import { FishLiveError, FishLiveTts, fishAudioBytes } from "../fish/live.js";
import { turnLogFields } from "../observe/fields.js";
import { noteOpsFailure } from "../ops/record.js";
import type { CatalogPersona } from "../personas.js";
import { type Utterance, VoiceAudioCapture, VoiceAudioStore } from "./audio.js";
import {
  applySpeechHold,
  createVoiceBargeIn,
  emptySpeechHold,
} from "./bargeIn.js";
import {
  type PendingLatency,
  clearVoiceCallState,
  setPendingLatency,
  setVoiceBargeIn,
  writeVoiceCallState,
} from "./callState.js";
import {
  failureMessage,
  isFatalFailure,
  voiceFailurePayload,
} from "./failures.js";
import { applyVoiceLatency } from "./latency.js";
import type { VoiceNoticeHub } from "./notices.js";
import { recordSttMeta, recordTtsMeta, sttMeta, ttsMeta } from "./record.js";
import { redisQuiet } from "./redisSafe.js";
import { streamThink } from "./thinkStream.js";
import { pcmDurationMs } from "./wav.js";

type Sql = ReturnType<typeof postgres>;

function sendJson(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function closeClient(socket: WebSocket): void {
  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close();
  }
}

function reportVoiceFailure(
  sql: Sql,
  config: GatewayConfig,
  log: FastifyBaseLogger,
  code: string,
): void {
  noteOpsFailure(sql, config, log, code, {
    message: failureMessage(config, code),
  });
}

export async function runFishVoiceCall(args: {
  socket: WebSocket;
  request: FastifyRequest;
  config: GatewayConfig;
  sql: Sql;
  redis: Redis;
  notices: VoiceNoticeHub;
  user: AppUser;
  persona: CatalogPersona;
  session: { id: string };
  voiceId: string;
}): Promise<void> {
  const {
    socket,
    request,
    config,
    sql,
    redis,
    notices,
    user,
    persona,
    session,
    voiceId,
  } = args;
  const log = request.log;
  const hangUpSitting = (onLost?: () => void) =>
    endSitting(sql, config, log, session.id, user.id, onLost);
  let listen: DeepgramListen | null = null;
  let fish: FishLiveTts | null = null;
  let thinkAbort: AbortController | null = null;
  const requestId = randomUUID();

  try {
    listen = await DeepgramListen.connect(
      config,
      config.DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS,
    );
  } catch (error) {
    log.error({ err: error }, "deepgram listen connect failed");
    reportVoiceFailure(sql, config, log, config.FAILURE_CODE_DEEPGRAM);
    sendJson(socket, voiceFailurePayload(config, config.FAILURE_CODE_DEEPGRAM));
    closeClient(socket);
    await hangUpSitting();
    return;
  }

  const redisOk = await redisQuiet(
    log,
    config,
    "writeVoiceCallState",
    session.id,
    () =>
      writeVoiceCallState(redis, config, {
        request_id: requestId,
        session_id: session.id,
        barge_in: false,
        pending_latency: [],
      }),
  );

  const sendFailure = (code: string) => {
    reportVoiceFailure(sql, config, log, code);
    sendJson(socket, voiceFailurePayload(config, code));
  };
  let redisWarned = false;
  const noteRedisFail = () => {
    if (!redisWarned) {
      redisWarned = true;
      sendFailure(config.FAILURE_CODE_REDIS);
    }
  };
  let recordWarned = false;
  const noteRecordLost = () => {
    if (!recordWarned) {
      recordWarned = true;
      sendFailure(config.FAILURE_CODE_RECORD);
    }
  };
  if (redisOk === null) {
    noteRedisFail();
  }

  let audioStore: VoiceAudioStore | null = null;
  const audioError = voiceAudioReady(config);
  if (voiceAudioPersistEnabled(config) && audioError) {
    log.warn(
      { sessionId: session.id, reason: audioError },
      "voice audio will not be stored",
    );
    reportVoiceFailure(sql, config, log, config.FAILURE_CODE_BLOB);
    sendJson(socket, {
      ...voiceFailurePayload(config, config.FAILURE_CODE_BLOB),
      reason: audioError,
    });
  } else if (voiceAudioPersistEnabled(config)) {
    try {
      const store = new VoiceAudioStore(config, sql, log);
      await store.ensureContainer();
      audioStore = store;
    } catch (error) {
      log.error(
        { err: error, sessionId: session.id },
        "voice audio store unavailable",
      );
      reportVoiceFailure(sql, config, log, config.FAILURE_CODE_BLOB);
      sendJson(socket, {
        ...voiceFailurePayload(config, config.FAILURE_CODE_BLOB),
        reason: error instanceof Error ? error.message : "blob store failed",
      });
    }
  }

  sendJson(socket, {
    type: config.VOICE_CLIENT_READY_TYPE,
    session_id: session.id,
    request_id: requestId,
  });

  const bargeIn = createVoiceBargeIn();
  const capture = new VoiceAudioCapture(config);
  capture.openUser();
  let pending: PendingLatency[] = [];
  let interrupted = false;
  let agentSpeaking = false;
  let turnLatency: PendingLatency | null = null;
  let turnGen = 0;
  let listenReady = true;
  let listenTurn = emptyListenTurn();
  // Sustained speech stops the audio; the reply still waits for the utterance
  // to finish, so the floor is never taken mid-sentence.
  let speechHold = emptySpeechHold();

  const sendAgent = (event: Record<string, unknown>) => {
    sendJson(socket, {
      type: config.VOICE_CLIENT_AGENT_EVENT_TYPE,
      event,
    });
  };

  const storeUtterance = async (utterance: Utterance) => {
    if (!audioStore) {
      return;
    }
    try {
      await audioStore.store(session.id, utterance);
    } catch (error) {
      log.error(
        { err: error, sessionId: session.id },
        "voice audio upload failed",
      );
      sendFailure(config.FAILURE_CODE_BLOB);
    }
  };

  const closeUserTurn = (transcript: string) => {
    const utterance = capture.closeUser();
    capture.openUser();
    if (!utterance && !transcript) {
      return;
    }
    void (async () => {
      if (transcript) {
        const turnId = await recordSttMeta(
          sql,
          session.id,
          sttMeta(config, transcript, requestId),
        ).catch((error: unknown) => {
          log.error(
            { err: error, sessionId: session.id },
            "stt metadata not recorded",
          );
          noteRecordLost();
          return null;
        });
        if (turnId) {
          log.info({ sessionId: session.id, turnId }, "voice stt recorded");
        }
      }
      if (utterance) {
        await storeUtterance(utterance);
      }
    })();
  };

  const flushAgent = () => {
    const utterance = capture.closeAgent();
    const wasInterrupted = interrupted;
    interrupted = false;
    if (!utterance) {
      return;
    }
    const durationMs = pcmDurationMs(utterance.pcm.length, {
      sampleRate: config.FISH_TTS_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: config.VOICE_AUDIO_BITS_PER_SAMPLE,
    });
    void (async () => {
      await recordTtsMeta(
        sql,
        session.id,
        ttsMeta(
          config,
          {
            bytes: utterance.pcm.length,
            durationMs,
            interrupted: wasInterrupted,
          },
          requestId,
          voiceId,
        ),
      ).catch((error: unknown) => {
        log.error(
          { err: error, sessionId: session.id },
          "tts metadata not recorded",
        );
        noteRecordLost();
        return null;
      });
      await storeUtterance(utterance);
    })();
  };

  const rememberBargeIn = (value: boolean) => {
    void redisQuiet(log, config, "setVoiceBargeIn", session.id, () =>
      setVoiceBargeIn(redis, config, session.id, value),
    ).then((saved) => {
      if (saved === null) {
        noteRedisFail();
      }
    });
  };

  const abortReply = () => {
    turnGen += 1;
    thinkAbort?.abort();
    thinkAbort = null;
    fish?.abort();
    fish = null;
  };

  const stopSpeaking = () => {
    abortReply();
    if (bargeIn.onUserStarted()) {
      interrupted = true;
      rememberBargeIn(true);
      log.info({ sessionId: session.id }, "voice barge-in");
      flushAgent();
    }
    agentSpeaking = false;
    sendAgent({ type: config.DEEPGRAM_MSG_USER_STARTED });
  };

  const closeLatencyTurn = () => {
    if (turnLatency) {
      pending.push(turnLatency);
      turnLatency = null;
    }
  };

  const drainLatency = async () => {
    if (pending.length === 0) {
      return;
    }
    const queue = pending;
    pending = [];
    const unmatched: PendingLatency[] = [];
    for (const item of queue) {
      const turnId = await applyVoiceLatency(sql, session.id, {
        sttMs: item.stt_ms,
        ttsFirstByteMs: item.tts_first_byte_ms,
        report: item.report,
      }).catch((error: unknown) => {
        log.error(
          { err: error, sessionId: session.id },
          "voice latency not recorded",
        );
        noteRecordLost();
        return null;
      });
      if (!turnId) {
        unmatched.push(item);
      }
    }
    pending = [...unmatched, ...pending];
    const saved = await redisQuiet(
      log,
      config,
      "setPendingLatency",
      session.id,
      () => setPendingLatency(redis, config, session.id, pending),
    );
    if (saved === null) {
      noteRedisFail();
    }
  };

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    listenReady = false;
    abortReply();
    listen?.close();
    listen = null;
    closeLatencyTurn();
    const trailing = capture.drain();
    void (async () => {
      for (const utterance of trailing) {
        await storeUtterance(utterance);
      }
      await drainLatency();
      const cleared = await redisQuiet(
        log,
        config,
        "clearVoiceCallState",
        session.id,
        () => clearVoiceCallState(redis, config, session.id),
      );
      if (cleared === null) {
        noteRedisFail();
      }
      await hangUpSitting(noteRecordLost);
      log.info({ sessionId: session.id }, "voice call ended");
    })();
  };

  const endCall = (code: string) => {
    sendFailure(code);
    cleanup();
    closeClient(socket);
  };

  const speakUtterance = async (transcript: string) => {
    const text = transcript.trim();
    if (!text) {
      return;
    }
    const gen = ++turnGen;
    closeUserTurn(text);
    sendAgent({
      type: config.DEEPGRAM_MSG_AGENT_THINKING,
    });
    bargeIn.onAgentThinking();
    rememberBargeIn(false);
    thinkAbort?.abort();
    thinkAbort = new AbortController();
    const thinkStarted = Date.now();
    turnLatency = {
      stt_ms: null,
      tts_first_byte_ms: null,
      report: {},
    };
    let live: FishLiveTts | null = null;
    try {
      live = await FishLiveTts.connect(config);
      if (gen !== turnGen) {
        live.abort();
        return;
      }
      live.start(voiceId);
      fish = live;
    } catch (error) {
      if (gen !== turnGen) {
        return;
      }
      if (error instanceof FishLiveError) {
        endCall(error.code);
        return;
      }
      endCall(config.FAILURE_CODE_FISH);
      return;
    }
    const offFish = live.onMessage((message) => {
      if (gen !== turnGen) {
        return;
      }
      const event = typeof message.event === "string" ? message.event : "";
      if (event === config.FISH_WS_EVENT_AUDIO) {
        const chunk = fishAudioBytes(message);
        if (!chunk) {
          return;
        }
        if (turnLatency && turnLatency.tts_first_byte_ms === null) {
          turnLatency.tts_first_byte_ms = Date.now() - thinkStarted;
        }
        if (!bargeIn.acceptBinary()) {
          return;
        }
        if (!agentSpeaking) {
          agentSpeaking = true;
          speechHold = emptySpeechHold();
        }
        capture.pushAgent(chunk);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(chunk);
        }
        return;
      }
      if (event === config.FISH_WS_EVENT_FINISH) {
        const reason = typeof message.reason === "string" ? message.reason : "";
        if (reason === config.FISH_WS_FINISH_REASON_ERROR) {
          endCall(config.FAILURE_CODE_FISH);
          return;
        }
        // Flush can complete a chunk; the session is only done after stop.
        if (!live.hasStopped()) {
          return;
        }
        bargeIn.onAgentAudioDone();
        rememberBargeIn(false);
        flushAgent();
        agentSpeaking = false;
        closeLatencyTurn();
        void drainLatency();
        sendAgent({ type: config.DEEPGRAM_MSG_AGENT_AUDIO_DONE });
        fish = null;
        live?.close();
      }
    });
    let spoken = "";
    try {
      const result = await streamThink(
        config,
        {
          appUserId: user.id,
          engramUserId: user.engramUserId,
          personaId: persona.id,
          sessionId: session.id,
        },
        text,
        thinkAbort.signal,
        (token) => {
          if (gen !== turnGen) {
            return;
          }
          spoken += token;
          live.sendText(token);
        },
      );
      if (gen !== turnGen) {
        offFish();
        return;
      }
      if (spoken.trim()) {
        sendAgent({
          type: config.DEEPGRAM_MSG_CONVERSATION_TEXT,
          role: config.VOICE_TRANSCRIPT_ASSISTANT_ROLE,
          content: spoken.trim(),
        });
      }
      if (result.spoke) {
        live.flush();
        live.stopStream();
      } else {
        offFish();
        live.close();
        fish = null;
        bargeIn.onAgentAudioDone();
        sendAgent({ type: config.DEEPGRAM_MSG_AGENT_AUDIO_DONE });
        closeLatencyTurn();
        void drainLatency();
      }
    } catch (error) {
      offFish();
      if (gen !== turnGen) {
        return;
      }
      if ((error as { name?: string }).name === "AbortError") {
        return;
      }
      log.error({ err: error, sessionId: session.id }, "fish think failed");
      endCall(config.FAILURE_CODE_THINK);
    }
  };

  const offListen = listen.onJson((message) => {
    const cue = readListenMessage(message, config);
    if (!cue) {
      return;
    }
    const applied = applyListenCue(listenTurn, cue);
    listenTurn = applied.turn;
    if (cue.kind === "speech_started") {
      // VAD also fires on Fish playback leaking into the mic. Aborting
      // or ducking here is a bare click. The browser ducks on interim
      // words; cut and think wait for speech_final or UtteranceEnd.
      if (!agentSpeaking) {
        sendAgent({ type: config.DEEPGRAM_MSG_USER_STARTED });
      }
      return;
    }
    if (applied.preview) {
      if (agentSpeaking) {
        const held = applySpeechHold(
          speechHold,
          Date.now(),
          config.VOICE_BARGE_IN_HOLD_MS,
        );
        speechHold = held.hold;
        if (held.stop) {
          // Sustained speech: give the floor back. Thinking still waits for
          // speech_final or UtteranceEnd, so the reply is not rushed.
          stopSpeaking();
        }
      }
      sendAgent({
        type: config.DEEPGRAM_MSG_CONVERSATION_TEXT,
        role: config.VOICE_TRANSCRIPT_USER_ROLE,
        content: applied.preview,
        final: false,
      });
      return;
    }
    if (!applied.transcript) {
      return;
    }
    speechHold = emptySpeechHold();
    if (agentSpeaking) {
      stopSpeaking();
    }
    sendAgent({
      type: config.DEEPGRAM_MSG_CONVERSATION_TEXT,
      role: config.VOICE_TRANSCRIPT_USER_ROLE,
      content: applied.transcript,
      final: false,
    });
    void speakUtterance(applied.transcript);
  });

  listen.onClose(() => {
    if (!cleaned && listenReady) {
      endCall(config.FAILURE_CODE_DEEPGRAM);
    }
  });

  const unwatch = notices.watch(session.id, (notice) => {
    if (notice.kind === config.VOICE_NOTICE_KIND_TRACE) {
      log.info(
        turnLogFields(config, {
          correlation_id: notice.correlation_id,
          session_id: notice.session_id,
          turn_ids: notice.turn_ids,
        }),
        config.LOG_TURN_EVENT,
      );
      return;
    }
    log.error({ sessionId: session.id, code: notice.code }, "voice notice");
    if (isFatalFailure(config, notice.code)) {
      sendJson(socket, {
        type: config.VOICE_CLIENT_ERROR_TYPE,
        code: notice.code,
        error: notice.message,
      });
      cleanup();
      closeClient(socket);
      return;
    }
    sendJson(socket, {
      type: config.VOICE_CLIENT_WARNING_TYPE,
      code: notice.code,
      warning: notice.message,
    });
  });

  socket.on("message", (data, isBinary) => {
    if (!listenReady || !listen) {
      return;
    }
    if (isBinary) {
      const frame = socketDataToBuffer(data);
      capture.pushUser(frame);
      listen.sendBinary(frame);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(socketDataToBuffer(data).toString("utf8"));
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const body = parsed as Record<string, unknown>;
    if (body.type !== config.DEEPGRAM_MSG_INJECT_USER) {
      return;
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      return;
    }
    const transcript = body.content.trim();
    sendAgent({
      type: config.DEEPGRAM_MSG_CONVERSATION_TEXT,
      role: config.VOICE_TRANSCRIPT_USER_ROLE,
      content: transcript,
    });
    void speakUtterance(transcript);
  });

  const finishClient = () => {
    unwatch();
    offListen();
    cleanup();
  };
  socket.on("close", finishClient);
  socket.on("error", finishClient);
}
