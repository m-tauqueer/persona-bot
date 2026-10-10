# 0006. Memory scope is a model decision

- Status: Proposed
- Date: 2026-09-09
- Decider: Tauqueer

## Context

Engram keeps two pools under a persona: shared teach (who the persona is) and the caller's private history. After the labelled retrieve path, both lists still reached the answerer on every turn. A self-directed question ("what do I do?") could still see the persona's bio; a persona-directed one could still see the member's history.

Choosing the pool is language understanding. Keyword matching, pronoun tables, and intent if/else are forbidden ([TRD](../architecture.md) §1.5, [AGENTS.md](../../AGENTS.md) §7). A classifier placed *before* Engram would add a full round trip to first word. Retrieve is already 0.7–1.5s; that window is where the decision has to finish.

`may_ground` is unconditional and structural. Nothing above it may bypass it or make it depend on the scope choice.

## Decision

A config-pluggable classifier returns a small structured object (chosen scope + reason code). It is issued **concurrently** with the two scoped retrieves, never in front of them. It has its own worker pool so it cannot queue behind retrieve or converse write-back.

The decision may only **remove** a labelled list after `may_ground` has already filtered every row. It cannot add a list. A narrowed-to-empty list is answered honestly; it is never filled from the other pool.

Timeout, error, or an unrecognised value **falls open to both pools**, recorded as a reason code. A degraded router must not starve a turn of memory. A member we cannot credential does not run the classifier; they stay on shared-only.

The chosen scope and reason code join the per-turn log allowlist. Memory text does not. Scope values, payload keys, prompt, model, and timeout come from config.

The classifier is off until `ENGRAM_SCOPE_ROUTER_ENABLED` is true.

## Consequences

Self-directed and persona-directed questions can be grounded on one pool. A wrong drop is unrecoverable, which is why fail-open exists and why this stayed off until a live sitting. First-word budget is the retrieve window plus any classifier overrun past Engram, not a new round trip.

Follow-up: live `/chat` and `/voice` sitting (including a Fish persona) and `npm run budgets`. Accept this record after that sitting if the budget holds; otherwise park the classifier.

## Alternatives considered

- Always pass both labelled lists (the recoverable path). Still the default while the flag is off.
- A single `scope=both` retrieve. Ranking reserves roughly half of `top_k` for shared, so the caller's pool starves.
- Keyword / pronoun routing. Forbidden.
- Classifier in front of retrieve. Adds a round trip to first word.
- Fail closed on classifier error. Would let a degraded router starve memory.
