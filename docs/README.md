# Documentation

Canonical index. Owner: Tauqueer.

Agents: read [`../AGENTS.md`](../AGENTS.md) (how to work), then [`progress.md`](progress.md) (where
we are), then the file that owns the work you were named. Humans can start here.

When you need **behaviour**, read the code. When you change **intent**, update the file that owns it.

---

## Active

1. [`../AGENTS.md`](../AGENTS.md) — owner, working loop, commit rules, commands
2. [`progress.md`](progress.md) — live status: what works, what is in flight, what is parked
3. [`plans/voice-audio.md`](plans/voice-audio.md) — **current work**: the echo/routing trade and
   per-persona voice configuration
4. [`plans/caller-memory.md`](plans/caller-memory.md) — caller facts in Engram private, sitting
   transcript in Postgres
5. [`decisions/`](decisions/README.md) — why we chose what we chose; do not re-litigate Accepted
   records

## Reference

| File | Role |
| --- | --- |
| [`architecture.md`](architecture.md) | How the system is built: transport, brain routing, data model |
| [`architecture/voice-audio.md`](architecture/voice-audio.md) | The browser audio path: capture, playback, echo, barge-in |
| [`architecture/memory.md`](architecture/memory.md) | Engram contract: pools, tenants, isolation |
| [`ops/deploy.md`](ops/deploy.md) | Azure deploy and the production shape |
| [`tests/README.md`](tests/README.md) | Every check and probe, and what each one proves |
| [`../frontend/COMPONENT_LIBRARY.md`](../frontend/COMPONENT_LIBRARY.md) | Which UI primitives may be copied |

## Reviews

[`reviews/`](reviews/) — audits and findings, dated. A review is a record of what was true on its
date. It is **not** rewritten when the code is fixed; the plan that acts on it says so instead.

- [`reviews/voice-audio-2026-09-18.md`](reviews/voice-audio-2026-09-18.md) — browser audio path and
  voice-provider configuration

## Archive

[`archive/`](archive/README.md) — superseded plans, completed phases, incident reports, measured
history. Ignore unless debugging history or a current file points at a parked one.

---

## Which file owns a change

| You changed… | Update |
| --- | --- |
| How agents work (loop, commits, current-work pointer) | [`../AGENTS.md`](../AGENTS.md) |
| Where we are: shipped vs current vs parked | [`progress.md`](progress.md) |
| How the system is built | [`architecture.md`](architecture.md) |
| The browser audio path | [`architecture/voice-audio.md`](architecture/voice-audio.md) |
| Engram pools, tenants, subscribe | [`architecture/memory.md`](architecture/memory.md) |
| A locked choice, new or replacement | A new file in [`decisions/`](decisions/README.md) |
| Named build steps | The current plan file only |
| Deploy or production shape | [`ops/deploy.md`](ops/deploy.md) |
| A check or probe was added | [`tests/README.md`](tests/README.md) |

Do not copy the same lock into three narratives. A **decision** lives in an ADR. The **current how**
lives in architecture. **Build order** lives in the named plan. `progress.md` points; it does not
duplicate.

---

## Docs process

Docs-only work follows the same loop as code ([`../AGENTS.md`](../AGENTS.md) §3). Markdown has no
test suite; the logic check is that the files agree with each other and with the locks in
[`decisions/`](decisions/README.md).

**Decision records.** One decision per file, numbered monotonically. Required sections: Context,
Decision, Consequences. Status becomes `Accepted` when Tauqueer locks it. Do not silently edit an
Accepted body to match a later choice — write a **new** record that supersedes it and mark the old
one `Superseded`. Date stamps and a short "Notes after" line on the original are fine; rewriting the
Decision is not. ADR when a future agent might reopen the choice (transport, isolation, fail-closed,
the working loop, docs structure) — not for every code change.

**What we do not do.** Phase or part numbers in commit messages, code comments, or PR titles — those
labels live only in the plan files. No AI attribution in git. No starting parked work because it
looks next. No treating the archive as a backlog.
