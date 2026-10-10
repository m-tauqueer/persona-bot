# 0009. Private memory is extracted caller facts, not the sitting transcript

- Status: Accepted
- Date: 2026-09-17
- Decider: Tauqueer

## Context

The default brain writes both sides of every turn into the caller’s Engram private pool (`personas.converse` of the user utterance and of first-person spoken reply). Retrieve labels every private hit `caller_memories`. Persona self-talk (“I work here”) and user questions about the persona (“are you working at Metacognition?”) become facts about the member. Isolation of *who can read the pool* is fine. Attribution inside the pool is not.

Postgres already stores the sitting (`sessions` + speaker-labelled `turns`). The answerer already receives a history window, but only as “continuity of address.” Long-term recall is the private pool, which voice needs because each call is a new sitting.

Keyword routing is forbidden. Conversation must never be promoted to shared.

## Decision

- This sitting’s conversation stays in Postgres. The answerer may use speaker-labelled sitting history as this-call context. History length is config (raised from the old default of 8).
- Engram private receives only LLM-extracted durable facts about the caller, written as private text (“The caller …”), not raw `converse` of the transcript.
- Two model passes, both off the reply path, both fail closed on that pass: per-turn (windowed) and a closing pass over the full sitting. Empty facts is success. Never fall back to dumping the transcript. Shared is unchanged.
- `/voice` runs the closing pass when the call already sets `ended_at`. How `/chat` runs that pass is named in [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md) §2 — not in this record until Tauqueer picks it.

## Consequences

Same-call “you just told me” does not wait on Engram. Next sitting recall depends on the extractor, not on a chat log in the private tenant. First-word latency must not gain an Engram write. Existing private rows from converse stay dirty until a named purge. `BRAIN_MODE=chat` would still write both sides inside Engram and stays off. Add-only: a later unsay is not forgotten in v1.

Build order: [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Code still converse-writes both sides until that plan ships.

Notes after 2026-09-17: typed-chat hang-up locked in [0010](0010-chat-ends-with-hangup.md). Retrieve path no longer converse-writes the sitting; Postgres history is this-call context; per-turn extractor writes caller facts as private text on the member JWT. Hang-up (voice `ended_at`, `/chat` End chat) runs the closing pass off the client path. Owner `list-private` / `forget-private` forgets one named member's private pool for one persona without `personas.delete`.

## Alternatives considered

- User-only `converse` with no model filter — still stores “are you working at Metacognition?” in the member’s tenant.
- Closing pass only (no per-turn) — misses facts if hangup/extract fails; typed chat has no hangup.
- Read-time classifier on a dirty pool — compression already mixed speakers; does not stop the write.
- Promote conversation into shared — leaks per-member dialogue and generated speech into everyone’s persona.
