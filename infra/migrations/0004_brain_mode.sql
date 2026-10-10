-- Which brain path produced a turn, so an A/B run is readable from SQL alone.

ALTER TABLE turns
  ADD COLUMN brain_mode text;

CREATE INDEX turns_brain_mode_idx ON turns (brain_mode) WHERE brain_mode IS NOT NULL;
