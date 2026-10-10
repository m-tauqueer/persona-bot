# Docs workflow

How we write and keep these files. Product working loop: [AGENTS.md](../../AGENTS.md) §3. Map: [README.md](README.md).

This is the process Tauqueer asked for: **one named part**, **subparts in order**, **tests and a logic check after each subpart**, **ask about a manual sitting after the part**, then **one short human commit** with no AI attribution and no phase/part numbers.

---

## 1. Product sitting (code or docs)

1. Tauqueer names a **phase** and a **part** from the current plan ([CALLER_MEMORY_PLAN.md](../plans/caller-memory.md) unless he names another file).
2. Do **only that part**. Its **subparts in order**. Nothing from later parts.
3. After **each subpart**: run the automated checks that cover the change, then a **logic check** of the diff (config not hardcoding; no keyword/heuristic language understanding; isolation and fail-closed; no tenant strings built by hand; audio never sent to Engram).
4. After the last subpart: **tell Tauqueer** whether a manual sitting is needed (live call, real Fish id, browser). If the part lists a Manual test, walk him through it and wait until it passes. If it lists none, say so. If UI changed, verify in the browser. Do not mark the part done until that is settled.
5. **Commit that part** (short imperative subject, optional one-line why). No phase/part numbers. No AI attribution, no `Co-authored-by`, no tool banners, no emojis. Do not skip hooks. Then **stop** until he names the next part.

Docs-only parts still follow this loop. Markdown has no test suite; the logic check is that the files agree with each other and with the locks in [decisions/](../decisions/README.md).

---

## 2. Which file owns a change

| You changed… | Also update |
| --- | --- |
| How agents must work (loop, commits, current-work pointer) | [AGENTS.md](../../AGENTS.md), this file if the loop text moved |
| “Where we are” (shipped vs current vs parked) | [CONTEXT.md](../progress.md), [PHASE_PLAN.md](../progress.md) |
| Product scope or success | [PRD.md](prd.md) |
| How the system is built | [TRD.md](../architecture.md) |
| Engram pools, tenants, subscribe | [ENGRAM.md](../architecture/memory.md) |
| A locked choice (new or replacement) | New file under [decisions/](../decisions/README.md); pointer in TRD if it is architecture |
| Named build steps | The current plan file only |
| Something is now live and measured | [SHIPPED.md](shipped.md) — history, not a new task list |
| Something is postponed | [FUTURE.md](future.md); remove it from the current plan |
| UI primitives we may copy | [COMPONENT_LIBRARY.md](../../frontend/COMPONENT_LIBRARY.md) |

Do not copy the same lock into three narratives. **Decision** lives in an ADR. **Current how** lives in the TRD. **Build order** lives in the named plan. **Snapshot** in CONTEXT points; it does not duplicate.

When code and docs disagree about **intent**, stop and ask Tauqueer. When they disagree about **behaviour**, believe the code, then fix the doc if intent still matches.

---

## 3. Decision records

Home: [docs/decisions/](../decisions/README.md). Template: [decisions/TEMPLATE.md](../decisions/TEMPLATE.md).

- One decision per file. Number monotonically (`0001-…`, `0002-…`).
- Required sections: Context, Decision, Consequences.
- Status is `Accepted` after Tauqueer locks it. Do not silently edit an Accepted body to match a later choice. Write a **new** record that supersedes the old one, and mark the old `Superseded`.
- Date stamps and a short “Notes after” line are allowed on the original. Rewriting the Decision is not.
- Do not ADR every code change. ADR when a future agent might re-open the choice (transport, isolation, fail-closed, working loop, docs structure).

---

## 4. What we do not do

- Empty `tutorials/` / `how-to/` / `reference/` / `explanation/` folders. Existing files stay put; [README.md](README.md) maps their roles.
- Phase or part numbers in commit messages, code comments, or PR titles.
- AI attribution in git.
- Starting [FUTURE.md](future.md) or Azure deploy because it “looks next.”
- Treating [SHIPPED.md](shipped.md) as a backlog.
