# Checks and probes

What each command proves, and which need live credentials. Run the ones that cover your change after
**each subpart**, then a logic check of the diff ([`../../AGENTS.md`](../../AGENTS.md) §3).

A probe is not a unit test. Probes talk to real services and exist because the thing they check —
a handshake, a stream, an isolation boundary — cannot be proven against a mock.

---

## Always, on any change

| Command | Proves |
| --- | --- |
| `npm run typecheck` | Frontend and gateway compile |
| `npm run lint` | Biome over `gateway/src` and `frontend/vite.config.ts` |
| `npm test` | Gateway, frontend, and worker suites |
| `npm run test:worker` | Worker pytest alone |

The copied component-library sources under `frontend/src` are excluded from lint so Biome does not
rewrite that tree.

## Offline probes — no credentials

| Command | Proves |
| --- | --- |
| `npm run bargein` | The barge-in state machine, including an interrupted turn that never reports its end |
| `npm run failures` | Failure taxonomy and reconnect rules, without causing a real outage |
| `npm run nav` | Personal vs admin nav lists |

## Live probes — need keys

| Command | Needs | Proves |
| --- | --- | --- |
| `npm run controller` | Engram | The controller's speak/silence decision |
| `npm run reframe` | OpenAI | Reframing a recalled answer into spoken output |
| `npm run chat` | Engram + OpenAI | A two-turn typed loop end to end |
| `npm run byo` | Engram + OpenAI | The Chat Completions shim Deepgram calls |
| `npm run brains` | Engram + OpenAI | The same questions through both `BRAIN_MODE` paths, side by side |
| `npm run voice` | Deepgram + a public worker URL | Voice Agent handshake and inject |
| `npm run call` | Deepgram + public URL | A full spoken call: synthesised speech in, STT, reply, interruption |
| `npm run fish` | `FISH_API_KEY` | Hosted Fish live TTS. Skips without the key |
| `npm run audio` | Azure Blob | WAV container, capture boundaries, turn binding, blob read-back |
| `npm run isolation` | Postgres | Two signed-in users cannot reach each other's conversation |
| `npm run security` | Postgres | Cookies, CORS, secrets, unauth think endpoint, hidden OpenAPI, then isolation |
| `npm run budgets` | Postgres + Engram | First-word p50/p90 against budget, plus an Engram request-log review |
| `npm run observe` | Postgres + Redis | Health, optional gateway/worker ping, a forced alert row |

Spoken calls need a live public think URL (`BYO_LLM_PUBLIC_URL`). Locally that is a tunnel; in
production it is the public origin.

## Manual sittings

Some behaviour cannot be automated and is checked by a person on a real device. After the last
subpart of a part, **tell Tauqueer** whether one is needed and walk him through it.

| What | Why it cannot be automated |
| --- | --- |
| Earpiece vs loudspeaker routing | No web API reports the output route; it is judged by ear |
| Echo leak in the room | Depends on the physical device, its speaker, and the room |
| True sink latency on a device | The `<audio>` element hop exposes no timing |
| Barge-in feel | Whether an interruption lands naturally is a judgement, not a threshold |
| Voice quality and character | The point of a persona's voice |
| Any UI change | Verify in the browser |

The audio ones are the subject of [`../plans/voice-audio.md`](../plans/voice-audio.md) phase 1,
which builds a diagnostic so these become *measured* observations rather than impressions.

## Local processes

```bash
npm run infra:up        # Postgres + Redis
npm run migrate         # apply infra/migrations
npm run dev:frontend    # Vite, FRONTEND_ORIGIN (5188)
npm run dev:gateway     # GATEWAY_PORT (4100; Vite proxies /auth /api /ws)
npm run dev:worker      # WORKER_PORT (8000)
npm run smoke           # external + local infra checks
npm run infra:down      # stop
npm run infra:reset     # stop and wipe volumes
```
