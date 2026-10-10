# 0008. First production sit lives in cognora-alpha-rg

- Status: Accepted
- Date: 2026-09-09
- Decider: Tauqueer
- Supersedes: the “new resource group only” clause of [0007](0007-production-same-origin.md)

## Context

The login that can run `az` is Contributor on `cognora-alpha-rg` and only Reader on the subscription, so it cannot create `rg-bot-metacog`. Tauqueer named this group so the bot can go up now.

## Decision

Create the bot’s own Container Apps environment, registry, Flexible Server, and Redis **in `cognora-alpha-rg`**, in **centralus** (this subscription refuses new Flexible Server in eastus). One public Container App runs nginx, gateway, and worker on localhost so the edge does not depend on cross-app DNS. Keep bot resource names on the `bot-` / `cae-bot-` / `psql-bot-` / `redis-bot-` / `acrbot` / `law-bot-` prefix. Do not reuse or change `cognora-alpha-pg`, the Key Vault, the VMs, or the VNet. Same-origin public URL, blobs off, and no CI/CD from [0007](0007-production-same-origin.md) still hold.

## Consequences

The group already holds Cognora. A bot outage or a billing surprise shares that group. Isolation is by resource name and new servers, not by group boundary.

## Alternatives considered

Wait for a new group and a Contributor grant — named, then replaced by this sit.
