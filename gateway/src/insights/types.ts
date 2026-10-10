import type { JsonValue } from "../json.js";

export type PersonalOverview = {
  sessions: number;
  turns: number;
  last_activity_at: string | null;
  last_session_id: string | null;
};

export type BrainModeCount = {
  brain_mode: string;
  turns: number;
};

export type OwnerOverview = {
  range: string;
  sessions: number;
  turns: number;
  active_users: number;
  median_first_word_ms: number | null;
  p90_first_word_ms: number | null;
  error_rate: number;
  brain_mode_split: BrainModeCount[];
  latency_budget_first_word_ms: number;
};

export type SessionListItem = {
  id: string;
  user_id: string;
  user_email: string;
  channel: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  turn_count: number;
  ended: boolean;
  brain_mode: string;
};

export type SessionList = {
  range: string;
  sessions: SessionListItem[];
  next_cursor: string | null;
};

export type TurnAudio = {
  direction: string;
  blob_url: string;
  duration_ms: number | null;
  format: string | null;
  size_bytes: number | null;
};

export type TurnLatency = {
  stt_ms: number | null;
  brain_ms: number | null;
  reframe_ms: number | null;
  reframe_first_token_ms: number | null;
  tts_first_byte_ms: number | null;
  total_ms: number | null;
  transport_latency: JsonValue;
};

export type TurnMemory = {
  memories_used: JsonValue;
  engram_session_id: string;
};

export type SessionTurn = {
  id: string;
  ordinal: number;
  speaker: string;
  text: string;
  messages: JsonValue;
  controller_action: string | null;
  controller_reasons: string[];
  stt_meta: JsonValue;
  tts_meta: JsonValue;
  brain_mode: string | null;
  correlation_id: string | null;
  created_at: string;
  latency: TurnLatency | null;
  memory: TurnMemory | null;
  audio: TurnAudio[];
};

export type SessionDetail = {
  id: string;
  user_id: string;
  user_email: string;
  persona_id: string;
  engram_session_id: string | null;
  channel: string;
  started_at: string;
  ended_at: string | null;
  turns: SessionTurn[];
};

export type ActivityPoint = {
  bucket_start: string;
  sessions: number;
  turns: number;
};

export type ActivitySeries = {
  range: string;
  bucket: string;
  points: ActivityPoint[];
};

export type StagePercentiles = {
  stage: string;
  p50: number | null;
  p90: number | null;
};

export type LatencyByBrainMode = {
  brain_mode: string;
  first_word: { p50: number | null; p90: number | null };
  stages: StagePercentiles[];
};

export type LatencyReport = {
  range: string;
  budget_first_word_ms: number;
  first_word: { p50: number | null; p90: number | null };
  stages: StagePercentiles[];
  by_brain_mode: LatencyByBrainMode[];
};

export type InsightsUser = {
  id: string;
  email: string;
  created_at: string;
  session_count: number;
  last_seen_at: string | null;
  subscription_status: string | null;
  access_request_id: string | null;
  access_status: string | null;
  owner: boolean;
};

export type InsightsUserList = {
  users: InsightsUser[];
  next_cursor: string | null;
};

export type BudgetModeRow = {
  brain_mode: string;
  samples: number;
  p50: number | null;
  p90: number | null;
};

export type LatestTrace = {
  turn_id: string;
  correlation_id: string;
  session_id: string;
  created_at: string;
};
