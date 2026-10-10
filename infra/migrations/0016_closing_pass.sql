-- One hang-up extract per sitting. A second hang-up is a no-op.

ALTER TABLE sessions
  ADD COLUMN closing_pass_at timestamptz;
