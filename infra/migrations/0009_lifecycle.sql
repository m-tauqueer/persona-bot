-- Consent, deletion requests. CHECK values must match gateway/src/schema.ts.
-- Existing members are backfilled as having accepted the launch versions.

CREATE TABLE consents (
  google_sub text PRIMARY KEY,
  privacy_version text NOT NULL,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  cookie_notice_at timestamptz
);

CREATE TABLE deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  google_sub text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
  completed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT deletion_requests_status_check
    CHECK (status IN ('pending', 'completed', 'cancelled'))
);

CREATE INDEX deletion_requests_status_requested_at_idx
  ON deletion_requests (status, requested_at DESC, id DESC);

INSERT INTO consents (google_sub, privacy_version, terms_version, accepted_at)
SELECT u.google_sub, '1', '1', u.created_at
FROM users u
ON CONFLICT (google_sub) DO NOTHING;
