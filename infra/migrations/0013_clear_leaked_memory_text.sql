-- Destroy retrieved memory text copied into our Postgres while every member
-- turn used one org API key. Those columns are mixed-owner by construction:
-- retrieve hits (and chat-mode replies grounded on them) from one member were
-- stored on another member's turns and memory_refs, and they survive the
-- victim's delete-my-data. We cannot tell which fact belonged to whom, so we
-- do not sort — we clear every row. brain_mode='chat' turns are included;
-- those replies were grounded in the same shared admin private pool. This is
-- intentional destruction of leaked personal data, not a schema reset.

UPDATE memory_refs
SET memories_used = '[]'::jsonb
WHERE memories_used IS DISTINCT FROM '[]'::jsonb;

UPDATE turns
SET messages = NULL
WHERE messages IS NOT NULL;
