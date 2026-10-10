import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { turnSpeakerPersona, turnSpeakerUser } from "../../lib/gateway";
import { loadUiCopy } from "../../lib/uiCopy";
import type { SessionDetail, SessionTurn, TurnAudio } from "../../lib/insights";

function audioLabel(clip: TurnAudio): string {
  const copy = loadUiCopy();
  if (clip.direction === copy.audioUserDirection) {
    return copy.audioUser;
  }
  if (clip.direction === copy.audioBotDirection) {
    return copy.audioBot;
  }
  return clip.direction;
}

function AudioClips({ clips }: { clips: TurnAudio[] }) {
  const copy = loadUiCopy();
  if (clips.length === 0) {
    return null;
  }
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      {clips.map((clip) =>
        clip.blob_url ? (
          <label key={`${clip.direction}:${clip.blob_url}`} style={{ color: "var(--text-mid)" }}>
            {audioLabel(clip)}
            <audio controls src={clip.blob_url} style={{ display: "block", marginTop: 4, width: "100%" }} />
          </label>
        ) : (
          <p key={`${clip.direction}:missing`} style={{ color: "var(--text-mid)" }}>
            {copy.audioAbsent}
          </p>
        ),
      )}
    </div>
  );
}

export function SpokenTranscript({ detail }: { detail: SessionDetail }) {
  const copy = loadUiCopy();
  const userSpeaker = turnSpeakerUser();
  const spoken = detail.turns.filter((turn) => turn.text.length > 0);
  if (spoken.length === 0) {
    return (
      <Card>
        <p style={{ color: "var(--text-mid)" }}>{copy.emptyTranscript}</p>
      </Card>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {spoken.map((turn) => (
        <Card key={turn.id}>
          <Badge>{turn.speaker === userSpeaker ? userSpeaker : turnSpeakerPersona()}</Badge>
          <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{turn.text}</p>
          <AudioClips clips={turn.audio} />
        </Card>
      ))}
    </div>
  );
}

function jsonBlock(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ReconstructTurn({ turn }: { turn: SessionTurn }) {
  const copy = loadUiCopy();
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <Badge>{turn.speaker}</Badge>
        {turn.controller_action ? (
          <Badge tone="accent">
            {copy.actionLabel}: {turn.controller_action}
          </Badge>
        ) : null}
        {turn.brain_mode ? <Badge>{turn.brain_mode}</Badge> : null}
      </div>
      {turn.text ? <p style={{ whiteSpace: "pre-wrap" }}>{turn.text}</p> : null}
      {turn.controller_reasons.length > 0 ? (
        <p style={{ color: "var(--text-mid)", marginTop: 8 }}>
          {copy.reasonsLabel}: {turn.controller_reasons.join(", ")}
        </p>
      ) : null}
      {turn.correlation_id ? (
        <p style={{ color: "var(--text-mid)", marginTop: 8 }}>
          {copy.correlationLabel}: {turn.correlation_id}
        </p>
      ) : null}
      {turn.latency ? (
        <pre style={{ marginTop: 8, color: "var(--text-mid)", whiteSpace: "pre-wrap" }}>
          {copy.latencyLabel}: {jsonBlock(turn.latency)}
        </pre>
      ) : null}
      {turn.memory ? (
        <pre style={{ marginTop: 8, color: "var(--text-mid)", whiteSpace: "pre-wrap" }}>
          {copy.memoryRefsLabel}: {jsonBlock(turn.memory)}
        </pre>
      ) : null}
      <AudioClips clips={turn.audio} />
      {turn.audio.length === 0 ? (
        <p style={{ color: "var(--text-mid)", marginTop: 8 }}>{copy.audioAbsent}</p>
      ) : null}
    </Card>
  );
}

export function SessionReconstruct({ detail }: { detail: SessionDetail }) {
  const copy = loadUiCopy();
  if (detail.turns.length === 0) {
    return (
      <Card>
        <p style={{ color: "var(--text-mid)" }}>{copy.emptyTranscript}</p>
      </Card>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {detail.turns.map((turn) => (
        <ReconstructTurn key={turn.id} turn={turn} />
      ))}
    </div>
  );
}
