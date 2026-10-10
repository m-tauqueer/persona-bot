-- Engram subscribe user_id is at most 32 characters. We stored the app
-- user UUID with hyphens (36). Same UUID without hyphens is 32 hex digits.

UPDATE users
SET engram_user_id = replace(lower(engram_user_id), '-', '')
WHERE engram_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
