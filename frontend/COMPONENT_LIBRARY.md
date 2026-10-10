# Component library

The Metacognition gallery and unused primitives do **not** live in this repo. Product docs: [docs/README.md](../docs/README.md). The card-grid picker is a named part in [PHASE_6_PLAN.md](../docs/archive/phase-6-plan.md) (paused). Current work is [CALLER_MEMORY_PLAN.md](../docs/plans/caller-memory.md). Do not start UI copy from this file.

**Source of truth:** `Desktop/component-library` (or whichever copy Tauqueer keeps on disk). Open that project when you need a primitive, a chart, or a shell piece. Copy only the file the product is about to use into `frontend/src`. Do not copy the gallery, and do not add this library as an npm dependency.

What stays here is what the voice bot actually renders: sign-in, the personal shell, chat, voice, personal home, and the admin app. Styles still load from `frontend/src/main.tsx` in the existing order so tokens keep working.

## Already in this repo

- `frontend/src/components/ui/Card.tsx` (variants `glass` / `paper` / `ember`)
- `frontend/src/components/Avatar.tsx`
- `frontend/src/components/ui/Button.tsx`, `Badge.tsx`, `Input.tsx`, `Meter.tsx`
- `frontend/src/components/Section.tsx`

## Allowed copies for the Home / persona card-grid work

Copy these only when that work is named, and only the files actually used:

- `Chip` — selected / voice-kind labels
- `QuickActions` **pattern** (Chat / Voice tiles with config copy and real routes) — not the gallery’s fake memory actions
- `Section` if Home needs the library’s dashboard section chrome beyond what we already have

**Do not copy:** `KpiStrip`, `FeaturedMemory`, `RecallHeatmap`, `MemoryActivity`, `NodeRing`, or other memory-product viz. Those belong to the other app.
