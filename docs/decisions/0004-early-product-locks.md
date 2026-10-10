# 0004. Early product locks still hold

- Status: Accepted
- Date: 2026-09-08
- Decider: Tauqueer

## Context

The first build locked product and platform choices in [TRD.md](../architecture.md) §1 and a short list in [SHIPPED.md](../archive/shipped.md). Those choices are easy to re-open while adding Fish and UI. They are not being revisited in the current plan.

## Decision

These still hold. Do not change them in a sitting unless Tauqueer names that change.

From the TRD (summary only; the TRD is the text):

- Many personas in the local catalog; members pick a published row; memory per (user, persona); owner-only create/teach.
- Browser mic, full-duplex barge-in, English first.
- Engram is the brain and the memory; speaking LLM is fact-locked; text-only into Engram; Engram down = product down.
- Redis ephemeral; Postgres canonical; Azure Blob for audio when that flag is on.
- Controller speak/silence from model/structured signals, never keyword understanding.
- TypeScript gateway + Python worker; Google OAuth; waitlist; hard isolation.

From SHIPPED (D-A … D-G): waitlist access; catalog many personas; free for now; GDPR-light; Azure later; Google-only; single region.

Engram isolation and per-member credentials: [ENGRAM.md](../architecture/memory.md), not this file.

## Consequences

Current work may add Fish TTS and member UI **on top of** these locks. It may not replace Engram, drop barge-in, open self-serve signup, or add extra IdPs. Parked items stay in [FUTURE.md](../archive/future.md).
