# Deploy

How the bot goes to production and what the live shape is. Why it is shaped this way:
[`../decisions/0007-production-same-origin.md`](../decisions/0007-production-same-origin.md) and
[`../decisions/0008-deploy-in-cognora-alpha-rg.md`](../decisions/0008-deploy-in-cognora-alpha-rg.md).

Those two records own the **decision**. This file owns the **procedure**.

---

## Shape

One public origin. `PUBLIC_ORIGIN` (default `https://bot.metacog.in`) is simultaneously
`FRONTEND_ORIGIN`, `GATEWAY_PUBLIC_URL`, `VITE_GATEWAY_URL` and `BYO_LLM_PUBLIC_URL`, so the browser,
the cookies, the Google callback, and the URL Deepgram calls for thinking are all the same origin.

```
                    ┌─────────────────────────────────────────┐
  browser ─────────►│ nginx  (the only public Container App)   │
                    │   /            → frontend static files   │
                    │   /auth /api /ws → gateway  (localhost)  │
                    │   think path only → worker  (localhost)  │
                    └─────────────────────────────────────────┘
                                  │            │
                         Flexible Server   Azure Cache
                            (Postgres)       (Redis)
```

nginx, gateway and worker run in **one** Container App on localhost, so the edge does not depend on
cross-app DNS. Gateway and worker ingress stay internal. Worker `/internal/*` is never on the public
edge — only the configured think path is.

Resources live in `cognora-alpha-rg`, region **centralus** (the subscription refuses new Flexible
Server in eastus). Bot resources keep the `bot-` / `cae-bot-` / `psql-bot-` / `redis-bot-` / `acrbot`
/ `law-bot-` prefixes. Do not touch `cognora-alpha-pg`, the Key Vault, the VMs, or the VNet — that
group also holds Cognora.

## Procedure

```bash
./infra/azure/deploy.sh check   # az login + write access on the configured group
./infra/azure/deploy.sh up      # build images, create/update Container Apps
./infra/azure/deploy.sh bind    # after the GoDaddy CNAME exists — managed cert bind
```

The script is linear and runs from the working tree. There is no CI/CD.

### Order matters

Sign-in does not work until **all three** of these are done, in order:

1. The GoDaddy **CNAME** points at the Container App.
2. The managed **certificate** is bound (`deploy.sh bind`).
3. The **existing** Google OAuth client has the origin and the callback URI added.

The `*.azurecontainerapps.io` hostname is a health check, not the product origin. Signing in there
will not work and is not a bug. There is no second OAuth client.

## Deliberately off

Turning any of these on needs a new named part — none of them is "just a flag."

| Off | Flag / reason |
| --- | --- |
| Blob audio archiving | `VOICE_AUDIO_PERSIST_ENABLED=false` until a storage account is named |
| CI/CD | No GitHub Actions. Deploys are the script, from the tree |
| Backups | Not in this sit |
| Key Vault | Secrets come from environment config |
| Staging slot | Not in this sit |
| `BRAIN_MODE=chat` | The slower brain, kept as a switch. Default is `retrieve` |

## Checks

```bash
npm run smoke      # external + local infra
npm run observe    # Postgres/Redis health, optional gateway/worker ping, forced alert row
npm run security   # cookies, CORS, secrets, unauth think endpoint, hidden OpenAPI, isolation
npm run budgets    # first-word p50/p90 against budget
```

Public `/status` shows live health without sign-in.

Manual test for a deploy: sign in on the public origin, then hold a live `/voice` call.

## Retention

```bash
npm run retain     # delete ended sessions older than RETENTION_SESSION_DAYS
```
