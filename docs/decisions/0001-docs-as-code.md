# 0001. Docs live in the repo

- Status: Accepted
- Date: 2026-09-08
- Decider: Tauqueer

## Context

Agents were inferring architecture from a one-line summary and treating old phase files as current work. Product locks lived in long plans and in the TRD at once. There was no durable “why” log, no current snapshot, and no written rule for when to update which file.

Industry practice (Diátaxis; Nygard/MADR ADRs; short `AGENTS.md` with progressive disclosure) says: keep docs next to the code; separate **how to work**, **where we are**, **what/how**, **why we chose**, and **what to build next**; do not dump everything into the always-loaded agent file.

## Decision

- Canonical map: [docs/README.md](../README.md).
- Snapshot: [docs/CONTEXT.md](../progress.md).
- How we update docs and run a sitting: [docs/WORKFLOW.md](../archive/workflow.md) plus [AGENTS.md](../../AGENTS.md).
- Decisions: numbered Markdown under [docs/decisions/](README.md). One decision per file. Accepted records are not rewritten; a later record supersedes them.
- Existing PRD, TRD, ENGRAM, phase plans, SHIPPED, FUTURE stay at `docs/*.md`. We map them to Diátaxis roles in the README. We do **not** move them into empty `tutorials/` / `how-to/` / `reference/` / `explanation/` directories.
- `AGENTS.md` stays the always-on operating manual (owner, loop, commits, how to start). It points at the map instead of duplicating every file’s job.

## Consequences

Agents have a single entry path and a place to put new locks without bloating the TRD. Moving files later would break links; the map is the structure, not new folders. If a lock in an ADR and the TRD drift, stop and ask — intent vs behaviour is in [WORKFLOW.md](../archive/workflow.md).
