-- One id per turn so a log line and a database row can be joined.

ALTER TABLE turns
  ADD COLUMN correlation_id uuid;

CREATE INDEX turns_correlation_id_idx
  ON turns (correlation_id)
  WHERE correlation_id IS NOT NULL;
