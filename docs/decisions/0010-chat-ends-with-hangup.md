# 0010. Typed chat ends with hang-up

- Status: Accepted
- Date: 2026-09-17
- Decider: Tauqueer
- Completes the `/chat` closing-pass trigger left open in [0009](0009-private-is-extracted-caller-facts.md)

## Context

[0009](0009-private-is-extracted-caller-facts.md) runs a second LLM filter when a sitting ends. `/voice` already sets `ended_at` on End call / socket close. `/chat` has no hang-up. The **New conversation** button only clears the browser sitting id; the Postgres session stays open.

Tauqueer named an End chat / hang-up control (not “starting a new chat implies the old one ended”).

## Decision

`/chat` gets one hang-up control (copy from config, same idea as End call). Pressing it sets `ended_at`, fires the caller-fact closing pass without waiting, and clears the on-screen sitting. The next send starts a new sitting. Do not keep a second local-only **New conversation** wipe. Leaving the tab without hanging up does not run the closing pass (per-turn extract may already have run).

## Consequences

Typed chat has a real end, like a call. A sitting left open for days is still one sitting until hang-up. Members who never hang up skip the safety-net pass; they do not skip per-turn facts.

Build order: [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md) Phase 3.

Notes after 2026-09-17: `/chat` End chat (`VITE_CHAT_END_LABEL`) sets `ended_at` and fires the same closing pass as End call / socket close. Next send mints a new sitting. Leaving the tab still skips the closing pass.

## Alternatives considered

- Treat “New conversation” / new sitting as the end — rejected; hang-up is explicit.
- Idle timer as end — rejected; that is not an end.
