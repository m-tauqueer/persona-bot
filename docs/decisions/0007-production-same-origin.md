# 0007. Production is one public origin

- Status: Accepted
- Date: 2026-09-09
- Decider: Tauqueer

## Context

The app already works locally with Vite proxying `/auth`, `/api`, `/health`, and `/ws` to the gateway so the browser, cookies, and Google callback share one origin. Aura think still needs a URL Deepgram can reach. We need that same loop on a public host so Tauqueer can test without a tunnel. Plan X CI/CD, backups, security 2.0, and blob persist were not named.

## Decision

Ship a first production sit as a new Azure resource group and a linear `infra/azure/deploy.sh` from the working tree. One public origin (`PUBLIC_ORIGIN`, default `https://bot.metacog.in`) is `FRONTEND_ORIGIN`, `GATEWAY_PUBLIC_URL`, `VITE_GATEWAY_URL`, and `BYO_LLM_PUBLIC_URL`. The public edge is an nginx Container App: frontend static files, gateway prefixes, and only the configured think path to the worker. Gateway and worker ingress stay internal. Postgres is Flexible Server. Redis is Azure Cache. Blob persist stays off. DNS is GoDaddy (CNAME), then a managed cert bind, then the existing Google OAuth client gets that origin and callback. No second OAuth client. No GitHub Actions.

## Consequences

Sign-in only works after the CNAME, the cert bind, and the Google URIs. The `*.azurecontainerapps.io` hostname is a health check, not the product origin. Worker `/internal/*` is not on the public edge. A later pipeline, Key Vault, staging slot, or turning blobs on needs a new named sit.

## Alternatives considered

Full Plan X (CI/CD then backups then security 2.0 then Azure) — not named. Deploying into an existing resource group — rejected; new group only. A second Google client — rejected.

Notes after 2026-09-09: the new-group clause is superseded by [0008](0008-deploy-in-cognora-alpha-rg.md). Same-origin edge is unchanged.
