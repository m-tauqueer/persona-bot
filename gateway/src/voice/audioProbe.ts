/**
 * Checks the parts of voice audio persistence that do not need Azure: the WAV
 * container, the capture boundaries, and the query that binds an utterance to
 * a turn. Reports whether blob upload itself is configured.
 */
import postgres from "postgres";
import { createBlobService } from "../clients.js";
import {
  loadGatewayConfig,
  voiceAudioPersistEnabled,
  voiceAudioReady,
} from "../config.js";
import { AUDIO_DIRECTION } from "../schema.js";
import { VoiceAudioCapture } from "./audio.js";
import { pcmDurationMs, wavFromPcm } from "./wav.js";

const config = loadGatewayConfig();
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

const sampleRate = config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE;
const bits = config.VOICE_AUDIO_BITS_PER_SAMPLE;
const bytesPerSample = bits / 8;
const pcm = Buffer.alloc(sampleRate * bytesPerSample);
const wav = wavFromPcm(pcm, { sampleRate, channels: 1, bitsPerSample: bits });

check("wav_riff", wav.toString("ascii", 0, 4) === "RIFF");
check("wav_wave", wav.toString("ascii", 8, 12) === "WAVE");
check("wav_fmt", wav.toString("ascii", 12, 16) === "fmt ");
check("wav_data", wav.toString("ascii", 36, 40) === "data");
check("wav_pcm_tag", wav.readUInt16LE(20) === 1);
check("wav_channels", wav.readUInt16LE(22) === 1);
check("wav_sample_rate", wav.readUInt32LE(24) === sampleRate);
check("wav_byte_rate", wav.readUInt32LE(28) === sampleRate * bytesPerSample);
check("wav_block_align", wav.readUInt16LE(32) === bytesPerSample);
check("wav_bits", wav.readUInt16LE(34) === bits);
check("wav_riff_size", wav.readUInt32LE(4) === 36 + pcm.length);
check("wav_data_size", wav.readUInt32LE(40) === pcm.length);
check("wav_length", wav.length === 44 + pcm.length, `${wav.length} bytes`);
check(
  "wav_duration",
  pcmDurationMs(pcm.length, {
    sampleRate,
    channels: 1,
    bitsPerSample: bits,
  }) === 1000,
);

const capture = new VoiceAudioCapture(config);
check("capture_closed_before_open", capture.closeUser() === null);
capture.openUser();
capture.pushUser(Buffer.alloc(640));
capture.pushUser(Buffer.alloc(640));
const userUtterance = capture.closeUser();
check(
  "capture_user",
  userUtterance?.pcm.length === 1280 &&
    userUtterance.direction === AUDIO_DIRECTION.USER,
);
check("capture_user_repeat", capture.closeUser() === null);
capture.pushAgent(Buffer.alloc(960));
const agentUtterance = capture.closeAgent();
check(
  "capture_agent",
  agentUtterance?.pcm.length === 960 &&
    agentUtterance.direction === AUDIO_DIRECTION.BOT,
);
check("capture_agent_repeat", capture.closeAgent() === null);

const overflow = new VoiceAudioCapture({
  ...config,
  VOICE_AUDIO_MAX_BYTES: 1000,
});
overflow.openUser();
overflow.pushUser(Buffer.alloc(640));
overflow.pushUser(Buffer.alloc(640));
const capped = overflow.closeUser();
check(
  "capture_max_bytes",
  capped?.pcm.length === 640 && capped.truncated === true,
);

const sql = postgres(config.DATABASE_URL);
try {
  // The newest voice call that still has a turn waiting for its audio. A call
  // whose audio is already stored has nothing left to bind.
  const sessions = await sql<{ id: string }[]>`
    SELECT s.id
    FROM sessions s
    WHERE s.channel = 'voice'
      AND EXISTS (
        SELECT 1
        FROM turns t
        LEFT JOIN audio_assets a ON a.turn_id = t.id
        WHERE t.session_id = s.id AND a.id IS NULL
      )
    ORDER BY s.started_at DESC
    LIMIT 1
  `;
  const session = sessions[0];
  if (!session) {
    console.log("turn_match=SKIP (every recorded turn already has its audio)");
  } else {
    const pick = (
      tx: postgres.TransactionSql,
      direction: string,
      speaker: string,
    ) => tx<{ id: string; ordinal: number }[]>`
      SELECT t.id, t.ordinal
      FROM turns t
      LEFT JOIN audio_assets a
        ON a.turn_id = t.id AND a.direction = ${direction}
      WHERE t.session_id = ${session.id}
        AND t.speaker = ${speaker}
        AND a.id IS NULL
      ORDER BY t.ordinal ASC
      LIMIT 1
    `;
    await sql
      .begin(async (tx) => {
        const [userTurn] = await pick(tx, AUDIO_DIRECTION.USER, "user");
        const [botTurn] = await pick(tx, AUDIO_DIRECTION.BOT, "persona");
        check(
          "turn_match",
          userTurn !== undefined && botTurn !== undefined,
          `user=ordinal ${userTurn?.ordinal} bot=ordinal ${botTurn?.ordinal}`,
        );
        if (userTurn) {
          await tx`
            INSERT INTO audio_assets (
              turn_id, direction, blob_url, duration_ms, format, size_bytes
            )
            VALUES (
              ${userTurn.id}, ${AUDIO_DIRECTION.USER},
              ${"probe://not-uploaded"}, 1000,
              ${config.VOICE_AUDIO_FORMAT}, ${wav.length}
            )
          `;
          const [again] = await pick(tx, AUDIO_DIRECTION.USER, "user");
          check(
            "turn_match_advances",
            again === undefined || again.ordinal !== userTurn.ordinal,
            "a claimed turn is not offered twice",
          );
        }
        throw new Error("probe-rollback");
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "probe-rollback") {
          throw error;
        }
      });
    const [left] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM audio_assets a
      INNER JOIN turns t ON t.id = a.turn_id
      WHERE t.session_id = ${session.id}
    `;
    console.log(`probe_rows_left=${left?.n ?? "0"}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

const audioError = voiceAudioReady(config);
if (!voiceAudioPersistEnabled(config)) {
  console.log("blob_fetch=SKIP (VOICE_AUDIO_PERSIST_ENABLED=false)");
} else if (audioError) {
  console.log(`blob_fetch=SKIP (${audioError})`);
} else {
  console.log(`blob_container=${config.AZURE_BLOB_CONTAINER}`);
  // Read the stored audio back the way a reviewer would.
  const sql2 = postgres(config.DATABASE_URL);
  try {
    const stored = await sql2<
      { direction: string; blob_url: string; size_bytes: string | null }[]
    >`
      SELECT a.direction, a.blob_url, a.size_bytes
      FROM audio_assets a
      INNER JOIN turns t ON t.id = a.turn_id
      INNER JOIN sessions s ON s.id = t.session_id
      WHERE s.channel = 'voice'
      ORDER BY a.created_at DESC
      LIMIT 2
    `;
    if (stored.length === 0) {
      console.log("blob_fetch=SKIP (no stored audio yet)");
    } else {
      const container = createBlobService(config).getContainerClient(
        config.AZURE_BLOB_CONTAINER as string,
      );
      for (const asset of stored) {
        const name = decodeURIComponent(
          new URL(asset.blob_url).pathname
            .split(`/${config.AZURE_BLOB_CONTAINER}/`)
            .slice(1)
            .join(`/${config.AZURE_BLOB_CONTAINER}/`),
        );
        const body = await container
          .getBlockBlobClient(name)
          .downloadToBuffer();
        const riff = body.toString("ascii", 0, 4) === "RIFF";
        const wave = body.toString("ascii", 8, 12) === "WAVE";
        const declared = body.readUInt32LE(40) + 44;
        check(
          `blob_fetch_${asset.direction}`,
          riff && wave && body.length === Number(asset.size_bytes),
          `${body.length} bytes, riff=${riff} wave=${wave} declared=${declared}`,
        );
      }
    }
  } finally {
    await sql2.end({ timeout: 5 });
  }
}

if (failed) {
  console.error(`FAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log("PROBE_OK");
