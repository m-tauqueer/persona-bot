-- Destroy spoken transcripts recorded before containment shipped.
-- Migration 0013 cleared retrieved-memory copies (turns.messages,
-- memory_refs.memories_used). It left turns.text — the spoken transcript.
-- Persona replies composed before the grounding filter were grounded on the
-- shared admin private pool, so another member's words can sit in a different
-- member's transcript and survive the speaker's delete-my-data.
--
-- We cannot tell which turns are contaminated. After containment, new turns are
-- clean by construction, so the only correct move is to clear the historical
-- ones. turns.text is NOT NULL, so we store an obviously redacted placeholder
-- rather than an empty string that would look like a missing write.
--
-- Cutoff is schema_migrations.applied_at for 0013_clear_leaked_memory_text.sql
-- — the moment leaked retrieve copies were cleared in this database — not a
-- wall-clock literal. Turns created after that timestamp are untouched.
-- A turn written while this file runs has created_at after that cutoff.
-- Re-running is a no-op: already-redacted rows stay redacted.

UPDATE turns
SET text = '[redacted: recorded before private memory was isolated]'
WHERE created_at < (
  SELECT applied_at
  FROM schema_migrations
  WHERE id = '0013_clear_leaked_memory_text.sql'
)
AND text IS DISTINCT FROM
  '[redacted: recorded before private memory was isolated]';
