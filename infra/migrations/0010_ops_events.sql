-- Operator alerts. CHECK values must match gateway/src/schema.ts OPS_SERVICE.

CREATE TABLE ops_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  service text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  correlation_id text,
  CONSTRAINT ops_events_service_check
    CHECK (service IN ('gateway', 'worker'))
);

CREATE INDEX ops_events_created_at_idx
  ON ops_events (created_at DESC, id DESC);
