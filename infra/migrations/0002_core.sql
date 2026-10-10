-- Canonical product tables. CHECK values must match gateway/src/schema.ts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  engram_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engram_persona_id text NOT NULL UNIQUE,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  voice_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER personas_set_updated_at
  BEFORE UPDATE ON personas
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  persona_id uuid NOT NULL REFERENCES personas (id) ON DELETE RESTRICT,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, persona_id),
  CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX subscriptions_user_id_idx ON subscriptions (user_id);
CREATE INDEX subscriptions_persona_id_idx ON subscriptions (persona_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  persona_id uuid NOT NULL REFERENCES personas (id) ON DELETE RESTRICT,
  engram_session_id text,
  channel text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT sessions_channel_check
    CHECK (channel IN ('text', 'voice'))
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_persona_id_idx ON sessions (persona_id);
CREATE INDEX sessions_engram_session_id_idx
  ON sessions (engram_session_id)
  WHERE engram_session_id IS NOT NULL;

CREATE TABLE turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  speaker text NOT NULL,
  text text NOT NULL,
  messages jsonb,
  controller_action text,
  controller_reasons jsonb,
  stt_meta jsonb,
  tts_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, ordinal),
  CONSTRAINT turns_ordinal_check CHECK (ordinal >= 1),
  CONSTRAINT turns_speaker_check
    CHECK (speaker IN ('user', 'persona')),
  CONSTRAINT turns_controller_action_check
    CHECK (
      controller_action IS NULL
      OR controller_action IN ('speak', 'silence')
    )
);

CREATE INDEX turns_session_id_idx ON turns (session_id);

CREATE TABLE memory_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL UNIQUE REFERENCES turns (id) ON DELETE CASCADE,
  memories_used jsonb NOT NULL,
  engram_session_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audio_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL REFERENCES turns (id) ON DELETE CASCADE,
  direction text NOT NULL,
  blob_url text NOT NULL,
  duration_ms integer,
  format text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_id, direction),
  CONSTRAINT audio_assets_direction_check
    CHECK (direction IN ('user', 'bot'))
);

CREATE INDEX audio_assets_turn_id_idx ON audio_assets (turn_id);

CREATE TABLE latency_spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL UNIQUE REFERENCES turns (id) ON DELETE CASCADE,
  stt_ms integer,
  brain_ms integer,
  reframe_ms integer,
  tts_first_byte_ms integer,
  total_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
