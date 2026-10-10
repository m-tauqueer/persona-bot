# Later work (parked)

Do **not** start anything in this file until Tauqueer names it. Map: [README.md](README.md). Snapshot: [CONTEXT.md](../progress.md). Current work is [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Fish/UI (paused): [PHASE_6_PLAN.md](phase-6-plan.md). History: [SHIPPED.md](shipped.md). Personas (built): [PHASE_5_PLAN.md](phase-5-plan.md).

Onboarding, cloned Fish voices, Home/picker UI, mobile, accessibility, and accounts moved to [PHASE_6_PLAN.md](phase-6-plan.md).

---

## Parked product (later than the current phase)

Leave these until Tauqueer pulls one forward:

- Scale & performance (load test, pools, worker concurrency, WebSocket scale, shedding)
- Billing (only if we charge — D-C)
- Growth loops (recaps, referrals, re-engagement)
- Multilingual code-switch (`language=multi`, config not a code branch)
- Fish self-host / GPU, Fish Agents replacing our brain, Fish STT, member-created clones
- Richer controller (safety, end-session, handoff, tools — still model/signal driven)
- More channels (telephony, WhatsApp, native mobile)
- Owner analytics (engagement, memory-growth, per-persona quality)
- User-shaped personas (members create/teach — isolation and moderation)

Feature/UX menu (candidates, not a promise): live captions; edit/forget a memory; push-to-talk; report a reply; recap email; PWA; i18n UI copy.

---

## Plan X — launch ops (last)

Order: **CI/CD → backups → security 2.0 → Azure deploy.** Azure is last of all — after product work and the rest of Plan X. Some checks only finish against real infra (live public-think, managed-Postgres restore, the pipeline deploy step).

### X.1 — CI/CD pipeline

Every change built, checked, shipped the same way. Typecheck, lint (Biome + Ruff), test suite, migration dry-run on every PR; image build/scan; staging on merge, prod on tag/approval; `npm audit` / uv audit; rollback path. Manual test: failing test blocks a PR; merge deploys to staging.

### X.2 — Backups & disaster recovery

Automated Postgres backups with a tested restore; Redis documented as ephemeral; Blob lifecycle; DR runbook (RPO/RTO, restore steps, contacts); secrets rotation. Manual test: restore drill on a throwaway environment, then a call works.

### X.3 — Security hardening 2.0

CSP, HSTS, X-Content-Type-Options, Referrer-Policy; dependency/image scanning in CI; secret rotation runbook; pen-test checklist; live public-think `401`; CORS/cookie for the production topology. Manual test: `npm run security` against staging.

### X.4 — Azure deployment (retire the tunnel)

First production sit (named): `cognora-alpha-rg`, a linear `infra/azure/deploy.sh` from the working tree, then GoDaddy CNAME and the existing Google OAuth client. Bot servers stay on their own names; Cognora’s Postgres / VMs / Key Vault are left alone. One public Container App runs nginx, gateway, and worker on localhost; Flexible Server Postgres; Azure Managed Redis. Worker `/internal/*` is not on the public edge; only the think path is. Blob persist stays **off**. No GitHub Actions, Key Vault, staging slot, or backups in this sit. Manual test: sign-in and a live `/voice` call on the public origin.

Still parked with the rest of Plan X: CI/CD, automated backups, security 2.0, turning blobs on.
