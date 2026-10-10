# 0005. Owner chooses Aura or Fish; do not infer from a Fish id

- Status: Accepted
- Date: 2026-09-08
- Decider: Tauqueer

## Context

[0002](0002-hosted-fish-tts-per-persona.md) stores a Fish voice id on a dedicated env-named key and forbids guessing Aura vs Fish from id shape. That still holds. The owner also needs an explicit **Deepgram Aura vs Fish Audio** choice, including storing a Fish id without changing the sitting, and choosing Fish only when they mean it. Inferring the sitting from “Fish key nonempty” would still be heuristic routing.

`/voice` still speaks Aura until speak work is named. This record only locks **how the choice is stored**.

## Decision

- Store the choice on a third env-named `voice_config` key (`PERSONA_VOICE_PROVIDER_KEY`). Allowed values come from `PERSONA_VOICE_PROVIDER_AURA` and `PERSONA_VOICE_PROVIDER_FISH`. Empty or missing means Aura.
- Admin `/admin/persona` has two choose buttons whose labels come from config. Saving writes that provider value. Cloning or pasting a Fish id does **not** switch the provider.
- Sit routing (when speak work is named) uses that provider value from env, not whether the Fish key is set. A Fish sitting still needs a Fish id and still fail-closes on missing key / 401 / 402 — no Aura fallback.
- Do not rewrite [0002](0002-hosted-fish-tts-per-persona.md). Dedicated Fish and Aura keys, hosted Fish only, no GPU, no id sniffing, clip bytes never to Engram or Postgres — all still stand.

## Consequences

A persona can hold a Fish id and still sit on Aura until the owner chooses Fish. Speak work must branch on the configured provider value, not on a nonempty Fish key.

## Alternatives considered

Infer Fish vs Aura from whether the Fish id is present — rejected (heuristic). One global TTS switch — rejected (per-persona lock in 0002).
