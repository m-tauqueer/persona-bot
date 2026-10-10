# Archive

Superseded plans, completed phases, incident reports, and measured history. Nothing here is a
backlog. Do not start work from this tree — if something in it should happen, it gets pulled into a
file under [`../plans/`](../plans/) first.

Kept because these records hold measurements, incident evidence, or locks that later files still
reference. Moved here 18 Sep 2026 in the docs restructure.

---

## Completed and superseded plans

| File | Was | Why it is here |
| --- | --- | --- |
| [`phase-5-plan.md`](phase-5-plan.md) | Personas end to end | Built. §4 listed leftover live sittings |
| [`phase-6-plan.md`](phase-6-plan.md) | Cloned Fish voices, then member UI | Paused. **§1 holds live locks** still referenced by [`../plans/voice-audio.md`](../plans/voice-audio.md) — notably §1.9 on Studio minutes vs Wallet API credits |
| [`prd.md`](prd.md) | Product requirements | Scope and success criteria for work now shipped |
| [`workflow.md`](workflow.md) | Docs process | Folded into [`../README.md`](../README.md) |
| [`future.md`](future.md) | Parked product, Plan X | Nothing starts from here until it is named into a plan |
| [`shipped.md`](shipped.md) | History and measured latency | The record of what went live and what the numbers were |

## Engram isolation work

The private-memory rollout of Sep 2026. Kept for the measurements and the incident account — if
memory isolation is ever questioned again, this is the evidence.

| File | Holds |
| --- | --- |
| [`engram-member-auth-report.md`](engram-member-auth-report.md) | Auth measurements per member |
| [`engram-member-private-workaround.md`](engram-member-private-workaround.md) | The leak investigation and what caused it |
| [`engram-private-rollout.md`](engram-private-rollout.md) | The named rollout plan |
| [`engram-scope-isolation.md`](engram-scope-isolation.md) | Scope isolation plan |

The contract those produced is live in [`../architecture/memory.md`](../architecture/memory.md).

## Deleted rather than archived

`PRODUCTION_PLAN.md` and `PHASE_PLAN.md` were removed in the restructure. Both were pointer stubs —
16 and 25 lines of links to other files, no content of their own. Recoverable from git history if
ever needed.
