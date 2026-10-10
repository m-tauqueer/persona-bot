# 0003. One named part, then stop

- Status: Accepted
- Date: 2026-09-08
- Decider: Tauqueer

## Context

Agents jumped ahead, mixed parked work with current work, and either committed without being asked or waited for a second “please commit.” Manual sittings were skipped or assumed. Commit messages leaked plan labels and AI banners.

## Decision

Tauqueer names **one part** from the current plan. That part’s **subparts run in order**. After **each subpart**: automated tests that cover the change, then a logic check. After the **part**: tell Tauqueer if a manual sitting is needed; if the part lists one, wait until it passes; if UI changed, verify in the browser. Then **one commit** for that part (short human message, no phase/part numbers, no AI attribution) and **stop** until he names the next part.

On this loop he does not also have to say “commit.” Work he names **outside** this loop still waits for an explicit commit instruction.

Full text: [AGENTS.md](../../AGENTS.md) §3–4 and [WORKFLOW.md](../archive/workflow.md).

## Consequences

Slower calendar time, fewer mixed diffs. Docs-only parts still get a logic pass and an explicit “no manual sitting” line. Amending a pushed commit remains forbidden; combining into the latest **unpushed** docs commit is allowed only when he says to fold Part 0 into it.
