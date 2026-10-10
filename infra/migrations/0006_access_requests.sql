-- Admission queue. CHECK values must match ACCESS_STATUS in gateway/src/schema.ts.
-- Existing members are backfilled as active so current accounts stay in.

CREATE TABLE access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_requests_status_check
    CHECK (status IN ('requested', 'approved', 'active', 'denied', 'revoked'))
);

CREATE TRIGGER access_requests_set_updated_at
  BEFORE UPDATE ON access_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE INDEX access_requests_status_requested_at_idx
  ON access_requests (status, requested_at DESC, id DESC);

INSERT INTO access_requests (
  google_sub,
  email,
  status,
  requested_at,
  decided_at
)
SELECT
  u.google_sub,
  u.email,
  'active',
  u.created_at,
  now()
FROM users u
ON CONFLICT (google_sub) DO NOTHING;
