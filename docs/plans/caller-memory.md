# Caller memory — facts about the member, not the sitting transcript

Current product work. Owner: Tauqueer. **Do only the phase and part he names.** Never start the next part yourself.

Goal: a sitting with Caleb or Sahil (or any persona) must not store persona-about-persona talk as the member’s private memory. This sitting’s conversation stays in Postgres. Engram private only receives **LLM-filtered facts about the caller**. Shared stays owner teach / imported bio.

Cloned Fish voices and member UI stay in [phase-6-plan.md](../archive/phase-6-plan.md) — paused until he names a part from that file.

---

## Docs map

Canonical map: [README.md](../README.md). Snapshot: [progress.md](../progress.md). Why: [decisions/README.md](../decisions/README.md), especially [0009](../decisions/0009-private-is-extracted-caller-facts.md). How we write docs and run a sitting: [README.md](../archive/workflow.md). Memory contract (live code until this plan ships): [memory.md](../architecture/memory.md).

This file is the **named phases and parts** for this work only. Do not put implementation in SHIPPED. Do not put parked Fish/UI work here. Do not mention phase/part numbers in commits, comments, or PR titles.

---

## Working loop

Full text: [README.md](../archive/workflow.md) and [AGENTS.md](../../AGENTS.md) §3. Tauqueer names **one phase and one part** from this file. Do only that part. Never jump ahead.

1. Do its **subparts in order**. Nothing from later parts.
2. After **each subpart**: run the automated checks that cover the change (`npm run typecheck`, lint, `npm test`, worker tests; `isolation` / `security` / `failures` when the part says so). Then a **logic check** of the diff: config not hardcoding; **no keyword/heuristic language understanding** (the filter is a model output or it does not happen); isolation and fail-closed; copy from config; no tenant strings built by hand; audio never sent to Engram; conversation never promoted to shared.
3. After the last subpart: **stop and tell Tauqueer** whether this part needs a manual sitting (live `/chat` or `/voice`, real persona). If the part lists a Manual test, walk him through it and wait until it passes. If it lists none (docs-only), say so. If UI changed, verify in the browser. Do not mark the part done until that is settled.
4. **Commit that part** (short imperative subject, optional one-line why). Do **not** mention phase or part numbers. No AI attribution. Do not skip hooks. Then **stop** until he names the next part.

---

## 1. Locked with Tauqueer (17 Sep 2026)

1. **Private is caller memory, not a transcript dump.** Engram `{org}:{persona}:{member}` holds durable facts about **that member** with that persona. The model decides what counts — plans, preferences, people, how they asked to be remembered, corrections, anything that should still be true next week — not a short coded list (name / job / city). Greetings, questions to the persona, and persona bio are dropped.
2. **The filter is an LLM.** No keyword matching, no “if it contains working/metacognition”, no intent if/else. Same rule as [0006](../decisions/0006-memory-scope-is-a-model-decision.md).
3. **This sitting is Postgres.** `sessions` + `turns` (already speaker-labelled) is the conversation. The answerer **may use** that history as this-call context. Raise the history window (`reframe_history_turns`; target default **24**, from config).
4. **Two filter passes, both off the reply path, both fail closed on that pass.**
   - After every turn: this turn + the sitting window. That is the live path so we do not miss everything.
   - When the sitting **ends**: the full transcript (size-capped from config). Safety net for what the per-turn pass skipped. Hangup must not wait on it.
5. **Writes.** Stop `personas.converse` of raw user text and raw spoken replies. Extracted facts go to `personas.private(pid).text` framed as “The caller …”. Never first-person “I work at …”. Empty `caller_facts` is success. Extractor error → write nothing extra (never dump the transcript). Duplicates are fine (Engram absorbs). One later **retry of the filter** is allowed; a dump is not.
6. **Shared is untouched.** Owner teach / document ingest only. Conversation is never promoted to shared.
7. **Same-sitting vs next sitting.** “You just told me” uses Postgres. The next voice call uses private. First-word latency must not grow by a new Engram round trip on the reply path.
8. **`BRAIN_MODE=chat` stays off.** Engram’s `chat` writes both sides itself. Out of this plan unless named.
9. **Add-only for v1.** No `forget` / retract if the caller later unsays a fact. Name that later if needed.
10. **Dirty pools.** Existing Caleb (and any live Sahil) private rows stay dirty until he names the cleanup phase. A write-path fix does not rewrite old episodes.
11. **Typed chat ends with hang-up, like a call.** `/chat` gets an End chat / hang-up control (copy from config, same idea as `/voice` `VITE_CALL_END_LABEL`). Pressing it sets `ended_at`, fires the closing pass (do not wait), clears the stored sitting, and empties the transcript. The next send starts a new sitting. Today’s **New conversation** button only wipes the browser id — it does **not** end Postgres — so Phase 3 replaces that local wipe with hang-up. One control, not two similar buttons. Leaving the tab without hanging up is like dropping a call: per-turn facts may already be in; the closing pass does not run.

---

## 2. Typed chat hang-up (locked 17 Sep 2026)

Tauqueer named **B**: an End chat / hang-up control, not “new sitting implies the old one ended.”

What is on `/chat` today: **New conversation** (`startFresh`) only clears the browser sitting id and the on-screen turns. The Postgres row stays open (`ended_at` null). There is no stop/hang-up that ends the sitting. `/voice` already has **End call**.

What we ship in Phase 3: one hang-up control on `/chat` (label from config; hang-up wording, not “New conversation”). Same lifecycle as End call: end the sitting, run the closing pass off the request, then the next message is a new sitting.

---

## 3. Stores (after this plan)

| Horizon | Store | Contents |
| --- | --- | --- |
| This sitting | Postgres `turns` | Full transcript, both speakers |
| This sitting, next reply | Answerer `history` | Last N speaker-labelled turns, **this-call context** |
| Later sittings, about the caller | Engram private | Extracted caller facts only |
| Every sitting, about the persona | Engram shared | Owner teach / import only |

Isolation does not change: private is still `{org}:{persona}:{member}`. What we **write** into it changes.

---

## 4. Phases (name a phase and a part)

### Phase 0 — Point the repo at this plan

- Goal: agents start here. Fish/UI is paused, not cancelled. No product code.
- Subparts:
  - **0.a** This file: locks, hang-up trigger, phases with parts.
  - **0.b** Current-work pointers: [AGENTS.md](../../AGENTS.md), [README.md](../README.md), [progress.md](../progress.md), [README.md](../archive/workflow.md), [progress.md](../progress.md), [ops/deploy.md](../ops/deploy.md), [shipped.md](../archive/shipped.md), [prd.md](../archive/prd.md), [architecture.md](../architecture.md) companion line, [FUTURE.md](../archive/future.md), [phase-5-plan.md](../archive/phase-5-plan.md), [phase-6-plan.md](../archive/phase-6-plan.md) paused banner, [engram-private-rollout.md](../archive/engram-private-rollout.md).
  - **0.c** [decisions/0009-private-is-extracted-caller-facts.md](../decisions/0009-private-is-extracted-caller-facts.md) and [0010](../decisions/0010-chat-ends-with-hangup.md).
- Tests: none (markdown). Logic: one current-work file; PHASE_6 still findable; no duplicate locks (ADR vs this file vs TRD-as-if-shipped).
- Manual: none.
- Commit: docs only.
- Done 17 Sep 2026: this file, pointers, ADR 0009 and 0010. Typed-chat hang-up is locked. SHIPPED leftover current-work line pointed at PHASE_6; restored. Do not redo 0.b/0.c unless a pointer drifted.

### Phase 1 — This sitting is the conversation

- Goal: stop dumping the transcript into Engram. Same-call flow uses Postgres history. Long-term private writes wait for Phase 2 (so a gap of “no new private writes” is expected and must be honest in logs).
- Subparts:
  - **1.a** Do not `converse` raw user text or `plan.spoken`. Keep write-receipts so a retried think still does not double-record Postgres turns. Degraded / unauthenticated members stay with no private write.
  - **1.b** Answer prompt: speaker-labelled `history` is this-sitting context. Long-term persona facts stay `persona_identity` + `persona_memories`. Long-term caller facts stay `caller_memories`. History must not be treated as the other list. Config, not a hardcoded number of turns.
  - **1.c** Raise `reframe_history_turns` default to **24** (`.env.example` + worker default). Extractor window in Phase 2 may share that cap; the closing pass uses the full sitting with its own size cap.
- Tests: write-back no longer calls `converse`; answer payload still has speakers; history length follows config. `isolation` unchanged.
- Manual: none until Phase 2 (private will go quiet for new turns). Tell Tauqueer that next-call recall of brand-new facts is paused until Phase 2.
- Done 17 Sep 2026: retrieve path does not converse user text or spoken reply; Postgres `write_receipts` still de-dupe persist; answerer uses speaker-labelled sitting history as this-call context (not the labelled memory lists); `reframe_history_turns` default 24. Private writes log `private_write_paused`.

### Phase 2 — Per-turn caller-fact extractor

- Goal: after each spoken/typed reply, a model may write caller facts to private. First word unchanged.
- Subparts:
  - **2.a** Config: model, prompt, payload keys, timeout, third-person fact framing, empty-list success. Structured JSON out. Unrecognised / timeout / error → no Engram write, reason code on the log allowlist (no memory text in logs).
  - **2.b** Input: this user turn + this persona reply + the sitting history window, speakers labelled. Output: `caller_facts` strings. Write each with `personas.private` text ingest on the **member JWT**. Fail closed. Never `converse`. Never shared.
  - **2.c** Same write-back thread / receipt as today’s converse so it cannot sit in front of retrieve. Tests with a mocked model: greeting → empty; “I live in Pune” → one caller fact; “are you working at Metacognition?” → empty; persona “I work at …” → empty.
- Manual: deferred to Phase 5 (Tauqueer, 17 Sep 2026: live sittings at the end). Until then: `/chat` with a published persona; say something about yourself; next **new** sitting should retrieve it as `caller_memories`. Ask the persona about their job; that must not appear as your private fact.
- Done 17 Sep 2026: config, extractor, `personas.private(pid).text` on the member JWT, write-back receipt. Automated checks passed. Live sitting waits for Phase 5. Do not start hang-up / closing pass until named.

### Phase 3 — Closing pass

- Goal: a second run of the **same** filter over the whole sitting when it ends. Production: async, idempotent, fail closed, never dump.
- Subparts:
  - **3.a** Internal “promote sitting” job: load speaker-labelled turns, cap bytes/turns from config, same extractor, private text writes, session receipt so hangup twice is a no-op. One retry of the filter on worker fault. Do not block the client.
  - **3.b** `/voice`: fire when `ended_at` is set (existing hangup / socket close).
  - **3.c** `/chat`: hang-up control (config copy) sets `ended_at` and fires the same job. Replace today’s local-only **New conversation** wipe so we do not ship two similar buttons. Next send creates a new sitting. Isolation: only the sitting owner can end it.
- Tests: double hangup one job; extractor error writes nothing; size cap. Isolation: job is the sitting owner.
- Manual: deferred to Phase 5 (Tauqueer, 17 Sep 2026: live sittings at the end). Until then: voice hangup after a call that included both a caller fact and a persona-job question; private has the fact, not the job. Chat hang-up ends the sitting, closing pass runs, next send is a new sitting.
- Done 17 Sep 2026: internal promote-sitting job, fire on voice `ended_at`, `/chat` End chat replaces New conversation. Automated checks passed. Live sitting waits for Phase 5. Do not start dirty-pool cleanup until named.

### Phase 4 — Dirty pool cleanup

- Goal: old converse dumps (Caleb, any live Sahil talk) are not left in retrieve.
- Subparts:
  - **4.a** Named purge of that member’s private pool for that persona (`user_memories` / `forget_user_memory` or equivalent already used by delete-my-data). Do not `personas.delete` (that destroys shared + every member).
  - **4.b** Document the operator steps Tauqueer runs (which member, which persona). No automatic wipe of every private pool.
- Manual: he confirms the named pool is empty, then a clean sitting.
- Done 17 Sep 2026: named `list-private` / `forget-private` on `npm run admin`. Same `user_memories` / `forget_user_memory` loop as delete-my-data. Does not `personas.delete`, does not unsubscribe, does not walk every member. Operator steps: [memory.md](../architecture/memory.md) §12.

### Phase 5 — Live sittings

- Goal: the product rule is true on `/chat` and `/voice` with a real persona (Caleb and/or Sahil Dhutt).
- Subparts:
  - **5.a** Typed sitting (includes the deferred Phase 2 check): user-about-self remembered next sitting; user-about-persona not in private; same-sitting follow-up uses Postgres history.
  - **5.b** Voice sitting: hangup closing pass; next call still has caller facts; barge-in unchanged.
  - **5.c** Memory panel shows extracted facts, not a raw transcript dump. `isolation` / `security` green.
- Manual: the sittings above, including a Fish persona if he names one.

---

## 5. Done when (this plan)

A member can talk to a persona about that persona’s work without those lines becoming the member’s private memory. Facts the member stated about themselves survive the next sitting. This sitting’s conversation is in Postgres. Isolation and fail-closed still hold. Then stop.

### Out of this plan

Forget/retract, `BRAIN_MODE=chat`, turning the scope router on, Fish/UI ([phase-6-plan.md](../archive/phase-6-plan.md)), Plan X / Azure leftovers, per-member Engram credential operator tasks ([engram-private-rollout.md](../archive/engram-private-rollout.md)).
