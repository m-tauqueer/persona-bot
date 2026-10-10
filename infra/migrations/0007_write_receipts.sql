-- One persist + write-back per (session, correlation). Two turn rows may share
-- a correlation id; the receipt is for the write, not each speaker row.

CREATE TABLE write_receipts (
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  correlation_id uuid NOT NULL,
  user_turn_id uuid REFERENCES turns (id) ON DELETE SET NULL,
  persona_turn_id uuid REFERENCES turns (id) ON DELETE SET NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  writeback_at timestamptz,
  PRIMARY KEY (session_id, correlation_id)
);
