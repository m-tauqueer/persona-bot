# 0012. Voice settings that differ between personas live on the persona

- Status: Proposed
- Date: 2026-09-18
- Decider: Tauqueer

## Context

[0005](0005-persona-voice-provider.md) put the **provider** choice on the persona, named from env,
never inferred from an id's shape. That was right, and it stopped halfway: the provider moved, and
everything the provider needs stayed global.

`FISH_TTS_MODEL` is one environment variable, read in exactly one place as a request header
(`gateway/src/fish/live.ts:87`). Every Fish persona in the deployment shares it. It cannot be set
per persona and cannot be reached from `/admin/persona`. The same is true of `FISH_TTS_LATENCY`,
`FISH_TTS_FORMAT` and `FISH_TTS_SAMPLE_RATE`.

The Deepgram side has the opposite failure. The Aura voice *is* per persona, but the admin surface
for it is a free-text "TTS voice id" input. Deepgram publishes roughly ninety Aura-2 voices across
eight languages and documents no list-voices endpoint, so the owner must recall and type
`aura-2-thalia-en` exactly. A typo is indistinguishable from an unavailable voice until a live
sitting fails.

Neither provider can be auditioned. A persona is published with a voice nobody has heard, and the
first listener is a member in a real call.

This surfaced as a suspicion that the deployment was stuck on a worse Fish voice than the account
allowed. It was not. Fish's own guidance says `s2.1-pro-free` is the same model as S2.1-Pro at $0,
without a guaranteed time-to-first-audio or a DPA — and
[`../archive/phase-6-plan.md`](../archive/phase-6-plan.md) §1.9 already locked that website Plus/Pro
minutes are Studio minutes while the API bills the Wallet. The voice was never worse. What is
genuinely missing is the **ability to choose**, and the latency guarantee that choice would buy.

## Decision

A voice setting that can reasonably differ between two personas belongs in that persona's
`voice_config`, under a key named from env, with the environment value as the **default** for
personas that set nothing. It is exposed in `/admin/persona`.

A setting that is genuinely deployment-wide — a transport encoding, a sample rate that must match
what the browser's playback graph was built for — stays environment-only. The test is whether two
personas in the same deployment could sensibly want different values, not whether the code could be
made to accept them.

Accepted values are configuration, never a list hardcoded in logic. Where the provider offers an
enumeration endpoint the catalogue is fetched; where it does not, the catalogue is config shaped the
same way a fetched one would be, so replacing the source later is not a rewrite. A free-text entry
stays available for a value the catalogue does not yet know, so the product is never blocked on our
list being current.

Both providers get a preview in admin: synthesise a configured line through that voice and play it,
owner-only, keys server-side.

## Consequences

The owner gains real control: model per persona, a voice chosen from a list rather than recalled,
and a way to hear it before members do. Typos become selectable mistakes instead of live failures.

`voice_config` grows, and the admin form grows with it. Each key needs a name from env, a default,
and handling for a persona that predates it — an absent key must mean "use the environment default"
and never an error.

Cost becomes visible, which is the point. Choosing `s2.1-pro` over `s2.1-pro-free` bills the Wallet
in exchange for a time-to-first-audio guarantee. The admin surface must say so plainly, or an owner
will reasonably assume the paid option sounds better. It does not; it arrives sooner, reliably.

Preview means the gateway synthesises speech outside a call. That path must carry the same
fail-closed behaviour as a sitting: a missing key or a 401/402 is an error with copy from config,
never a silent fall back to the other provider.

Nothing here changes the routing rule from [0005](0005-persona-voice-provider.md). The provider key
still decides the sitting, and a stored id still never implies a provider.

## Alternatives considered

**Change `FISH_TTS_MODEL` to the paid model and stop.** One line, and it would have closed the
original complaint. Rejected: it answers a question the owner did not actually have — the free model
is not a worse voice — while leaving every persona sharing one setting and the Aura box still
free-text.

**Put every provider knob on the persona.** Rejected. Format, encoding and sample rate must agree
with the browser's playback graph; making them per-persona invites a persona configured into
silence for reasons no error message would explain.

**Hardcode the Aura catalogue.** Rejected under the no-hardcoding rule, and it would go stale.
Config, with a probe to establish whether an endpoint exists, keeps the shape right either way.
