import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type postgres from "postgres";
import { createBlobService } from "../clients.js";
import type { GatewayConfig } from "../config.js";
import { AUDIO_DIRECTION, type AudioDirection } from "../schema.js";
import { pcmDurationMs, wavFromPcm } from "./wav.js";

type Sql = ReturnType<typeof postgres>;

export type Utterance = {
  direction: AudioDirection;
  pcm: Buffer;
  truncated: boolean;
};

type Shape = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
};

function shapeFor(config: GatewayConfig, direction: AudioDirection): Shape {
  return {
    sampleRate:
      direction === AUDIO_DIRECTION.USER
        ? config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE
        : config.DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE,
    channels: 1,
    bitsPerSample: config.VOICE_AUDIO_BITS_PER_SAMPLE,
  };
}

/**
 * Buffers one utterance per direction. Boundaries come from transport events,
 * never from transcript text: the user side opens when the transport says the
 * user started speaking and closes when it starts thinking; the agent side
 * closes when its audio is done.
 */
export class VoiceAudioCapture {
  private user: Buffer[] = [];
  private userBytes = 0;
  private userOpen = false;
  private userTruncated = false;
  private agent: Buffer[] = [];
  private agentBytes = 0;
  private agentTruncated = false;

  constructor(private readonly config: GatewayConfig) {}

  openUser(): void {
    this.userOpen = true;
  }

  pushUser(chunk: Buffer): void {
    if (!this.userOpen) {
      return;
    }
    if (this.userBytes + chunk.length > this.config.VOICE_AUDIO_MAX_BYTES) {
      this.userTruncated = true;
      return;
    }
    this.user.push(chunk);
    this.userBytes += chunk.length;
  }

  closeUser(): Utterance | null {
    if (!this.userOpen) {
      return null;
    }
    const pcm = Buffer.concat(this.user);
    const truncated = this.userTruncated;
    this.user = [];
    this.userBytes = 0;
    this.userOpen = false;
    this.userTruncated = false;
    if (pcm.length === 0) {
      return null;
    }
    return { direction: AUDIO_DIRECTION.USER, pcm, truncated };
  }

  pushAgent(chunk: Buffer): void {
    if (this.agentBytes + chunk.length > this.config.VOICE_AUDIO_MAX_BYTES) {
      this.agentTruncated = true;
      return;
    }
    this.agent.push(chunk);
    this.agentBytes += chunk.length;
  }

  closeAgent(): Utterance | null {
    const pcm = Buffer.concat(this.agent);
    const truncated = this.agentTruncated;
    this.agent = [];
    this.agentBytes = 0;
    this.agentTruncated = false;
    if (pcm.length === 0) {
      return null;
    }
    return { direction: AUDIO_DIRECTION.BOT, pcm, truncated };
  }

  /** Anything still buffered when the call ends is still part of the record. */
  drain(): Utterance[] {
    const out: Utterance[] = [];
    const user = this.closeUser();
    if (user) {
      out.push(user);
    }
    const agent = this.closeAgent();
    if (agent) {
      out.push(agent);
    }
    return out;
  }
}

export type StoredAudio = {
  turnId: string;
  direction: AudioDirection;
  url: string;
  durationMs: number;
  sizeBytes: number;
};

export class VoiceAudioStore {
  private readonly container;

  constructor(
    private readonly config: GatewayConfig,
    private readonly sql: Sql,
    private readonly log: FastifyBaseLogger,
  ) {
    const service = createBlobService(config);
    const name = config.AZURE_BLOB_CONTAINER;
    if (!name) {
      throw new Error("AZURE_BLOB_CONTAINER is not set");
    }
    this.container = service.getContainerClient(name);
  }

  async ensureContainer(): Promise<void> {
    await this.container.createIfNotExists();
  }

  /**
   * Store one utterance against the oldest turn of the matching speaker that
   * has no audio yet. Utterances and turns are both in order, so they line up.
   */
  async store(
    sessionId: string,
    utterance: Utterance,
  ): Promise<StoredAudio | null> {
    const speaker =
      utterance.direction === AUDIO_DIRECTION.USER ? "user" : "persona";
    const rows = await this.sql<{ id: string }[]>`
      SELECT t.id
      FROM turns t
      LEFT JOIN audio_assets a
        ON a.turn_id = t.id AND a.direction = ${utterance.direction}
      WHERE t.session_id = ${sessionId}
        AND t.speaker = ${speaker}
        AND a.id IS NULL
      ORDER BY t.ordinal ASC
      LIMIT 1
    `;
    const turnId = rows[0]?.id;
    if (!turnId) {
      this.log.warn(
        { sessionId, direction: utterance.direction },
        "no turn to attach voice audio to",
      );
      return null;
    }

    const shape = shapeFor(this.config, utterance.direction);
    const body = wavFromPcm(utterance.pcm, shape);
    const durationMs = pcmDurationMs(utterance.pcm.length, shape);
    const name = `${this.config.AZURE_BLOB_KEY_PREFIX}${sessionId}/${utterance.direction}-${randomUUID()}.${this.config.VOICE_AUDIO_FORMAT}`;
    const blob = this.container.getBlockBlobClient(name);
    await blob.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: this.config.VOICE_AUDIO_CONTENT_TYPE,
      },
    });

    await this.sql`
      INSERT INTO audio_assets (
        turn_id, direction, blob_url, duration_ms, format, size_bytes
      )
      VALUES (
        ${turnId},
        ${utterance.direction},
        ${blob.url},
        ${durationMs},
        ${this.config.VOICE_AUDIO_FORMAT},
        ${body.length}
      )
      ON CONFLICT (turn_id, direction) DO NOTHING
    `;

    return {
      turnId,
      direction: utterance.direction,
      url: blob.url,
      durationMs,
      sizeBytes: body.length,
    };
  }
}
