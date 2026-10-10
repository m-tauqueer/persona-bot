# Voice persona bot

A browser voice bot that speaks as a **persona** — a character an owner teaches — and remembers the
people it talks to across calls.

You sign in, pick a published persona, and talk to it. It answers in that persona's voice. The next
time you call, it remembers you: not the transcript of what you said, but the facts about you worth
keeping. Every caller gets their own private memory with that persona, and no caller can reach
another's.

---

## What makes it different

Most voice bots forget you the moment you hang up, and the ones that don't tend to remember by
replaying a transcript back into a prompt.

- **Memory is a first-class store, not a longer prompt.** Long-term memory lives in
  [Engram](https://engram-docs-alpha.netlify.app/). What a caller says is filtered by a model into
  durable *facts* before anything is written. The raw sitting stays in Postgres.
- **Private memory is per (caller, persona).** Each member authenticates to Engram with their own
  token, so their facts land in their own pool. A member the system cannot credential degrades to
  shared-only — it never falls back to another account's private memory.
- **Personas are taught, not prompted.** An owner creates a persona, teaches it, ingests material,
  and publishes it. Shared knowledge belongs to the persona; private memory belongs to the caller.
- **The voice is per persona.** Deepgram Aura by default, or a cloned voice through Fish Audio, as a
  property of that persona rather than a global setting.
- **No keyword heuristics.** Whether the bot should speak, what it recalls, and what it stores are
  model and signal decisions. There is no `if text.contains(...)` anywhere in the understanding
  path, by rule.

## How it works

```
  browser ──mic PCM──►  gateway  ──►  Deepgram  (Nova-3 speech-to-text)
                           │
                           │   the reply is produced by our own brain, not the
                           │   speech vendor's, through a BYO-LLM shim:
                           ▼
                        worker  ──►  controller   should the persona speak at all?
                           │         Engram       recall: persona knowledge + caller facts
                           │         reframe LLM  turn the recalled answer into spoken language
                           ▼
                        Deepgram Aura  ──or──  Fish Audio   (text to speech)
                           │
  browser ◄──reply PCM─────┘
```

Two speech paths, chosen per persona:

| Persona's provider | Path |
| --- | --- |
| Aura (or unset) | Deepgram Voice Agent — speech-to-text, text-to-speech and turn-taking in one socket |
| Fish | Deepgram listen for speech-to-text, our brain, then Fish Audio for the cloned voice |

The brain is identical either way. Speech vendors only turn text into sound and sound into text.

Full detail: [`docs/architecture.md`](docs/architecture.md). The browser audio path — capture,
playback, echo handling — is [`docs/architecture/voice-audio.md`](docs/architecture/voice-audio.md).

## Stack

| Part | Built with |
| --- | --- |
| `frontend/` | React 18, Vite, Tailwind |
| `gateway/` | TypeScript, Fastify — Google auth, chat HTTP, admin proxy, speech transport |
| `worker/` | Python 3.12 (uv) — Engram, controller, reframe, the BYO-LLM endpoint, voice cloning |
| `infra/` | Docker Compose (Postgres, Redis), migrations, Azure deploy |

npm workspaces at the root cover `frontend/` and `gateway/`. The worker is Python and is not in the
JS workspace.

## Running it

Requires Node 22+, Python 3.12 (via [uv](https://docs.astral.sh/uv/)), and Docker.

```bash
git clone <this repo> && cd voice-bot
cp .env.example .env          # then fill in the secrets — see below

npm install
cd worker && uv sync && cd ..

npm run infra:up              # Postgres + Redis
npm run migrate

npm run dev:gateway           # port 4100
npm run dev:worker            # port 8000
npm run dev:frontend          # port 5188 — open this one
```

Verify the setup with `npm run smoke`. Every check and probe is catalogued in
[`docs/tests/README.md`](docs/tests/README.md).

### Credentials

The app will not boot without Google Sign-In configured. The rest degrade in defined ways.

| Service | Needed for | Without it |
| --- | --- | --- |
| Google OAuth | Sign-in | Gateway will not boot |
| [Engram](https://engram-docs-alpha.netlify.app/) | Memory and the brain | No typed chat, no voice |
| OpenAI (or the configured reframe model) | Turning recall into speech | No typed chat, no voice |
| [Deepgram](https://developers.deepgram.com/) | Speech to text, and Aura voices | No spoken calls |
| [Fish Audio](https://docs.fish.audio/) | Cloned persona voices | Only personas set to Fish fail — closed, never silently on Aura |
| Azure Blob Storage | Archiving call audio | Off by default (`VOICE_AUDIO_PERSIST_ENABLED=false`) |

Spoken calls need a URL Deepgram can reach for thinking (`BYO_LLM_PUBLIC_URL`). Locally that is a
tunnel; in production it is the public origin.

### Configuration

Everything configurable comes from the environment — there are no magic values in logic, by rule.
`.env.example` is the reference and is annotated. A single `.env` at the root serves all three
services.

## Documentation

| | |
| --- | --- |
| [`docs/README.md`](docs/README.md) | Index — start here |
| [`docs/progress.md`](docs/progress.md) | What works, what is in flight, what is parked |
| [`docs/architecture.md`](docs/architecture.md) | Transport, brain routing, data model |
| [`docs/architecture/memory.md`](docs/architecture/memory.md) | The Engram contract and isolation rules |
| [`docs/decisions/`](docs/decisions/README.md) | Why things are the way they are |
| [`docs/ops/deploy.md`](docs/ops/deploy.md) | Production shape and deploy procedure |
| [`AGENTS.md`](AGENTS.md) | How work is done in this repo — read before contributing |

## Status

Alpha, and honest about it. Typed chat and spoken calls work; personas, memory isolation, quotas,
consent/export/delete and a public `/status` are in. Deployment is a script, not a pipeline.

The spoken call is currently half-duplex — you cannot interrupt the persona mid-sentence. That is a
known trade being actively measured and reversed; see
[`docs/plans/voice-audio.md`](docs/plans/voice-audio.md) and the audit it rests on,
[`docs/reviews/voice-audio-2026-09-18.md`](docs/reviews/voice-audio-2026-09-18.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) first — it is short and it is binding. The essentials: work one named
part at a time, run the checks that cover your change after each subpart, and keep configuration out
of logic. Commit messages are plain and imperative, with no phase numbers and no AI attribution.
