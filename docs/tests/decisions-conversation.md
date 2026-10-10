# Conversational Decisions validation and manual handoff

Date: 10 Oct 2026. Owner: Tauqueer. [Implementation plan](../plans/openai-decisions.md).
Phase 2 code is implemented. Activation, owner-approved labels/thresholds, product sittings and
paired first-word measurements remain pending. Tauqueer explicitly authorized this code before
Phase 1's sitting; that does not mark either manual gate passed. `.env` and running services were
not changed. Tauqueer explicitly requested committing and pushing the implementation on 10 Oct 2026;
that publication does not close the acceptance/evidence gates.

## Behavior and boundaries

`CONVERSATION_DECISIONS_MODE=off` is the default. Shadow classifies without changing generation;
active permits answer or acknowledge. Requests/questions, choice values/descriptions, hint field,
generation instructions, reason codes, thresholds, context limits and deadlines come from config.
Active retrieve mode requires a key and calibrated threshold. Duplicate question names, choices,
reason codes, payload-field collisions and invalid instruction templates are rejected at startup.

Enabled scope and conversation questions share one Decisions request, one bounded slot and one
absolute deadline beside retrieval. Modes are independent. Missing/refused/malformed answers affect
only their named policy. Shared-only callers can receive the conversation question without a scope
question or private recall. `BRAIN_MODE=chat` explicitly skips conversational classification.
Shadow-only bundles do not wait; a mixed active/shadow bundle waits only for its remaining budget.
Late results cannot mutate a reply or trigger another utterance. The explicit legacy scope backend
can retain its old classifier request alongside the single conversation request for rollback.

The existing controller still owns speech eligibility. Empty input, empty replies and Engram errors
retain their structural handling, including the existing honest narrowed-empty exception. Reply mode
never revives a silence/refusal or admits a memory row. There is no keyword matching, wait state,
new public endpoint, schema migration, UI, or audio/transport change.

The answerer receives a reply-mode hint only for active, speak-eligible retrieve turns. Off omits it;
shadow omits it. Maintained generation instructions are appended even with a custom
`ANSWER_SYSTEM_PROMPT`. Both blocking and streaming paths make one speaking request. Acknowledge
receives the caller naturally and briefly while preserving grounding/persona style; it does not
promise storage, add biography/advice, or invent a follow-up. Actual generated text is persisted and
continues through the existing private caller-fact and hang-up extraction paths.

Telemetry distinguishes raw requested mode, policy candidate and applied turn mode. Callback logs
carry captured session/correlation ids and only allowlisted metadata. No input/history/memory/key or
free-form provider rationale is supplied. Applied mode/reason append to `controller_reasons` alongside
structural reasons; generation hints are not assumed to persist themselves.

## Automated evidence

- Gateway and frontend suites passed: 175 and 85 tests respectively.
- Final worker suite: **368 passed, one pre-existing skip**, **86.53%** coverage against the 80% gate.
- Targeted conversational suite: **43 passed**, including all nine scope/reply mode combinations,
  one-request assertions, per-question refusal, shared-only callers, chat skip (including generation hints after credential degradation), legacy rollback,
  deadlines, shadow/late results, separate concurrent sittings, custom prompts/values, blocking and
  streaming propagation, actual utterance persistence, receipts and private extraction after acknowledgment.
- Typecheck, Biome lint and worker Ruff passed.
- Security (including isolation), offline failure and barge-in probes passed.
- BYO SSE parsing and missing/wrong identity-header checks passed with `PROBE_PERSONA_ID=`.
  Its real persona-writing sitting was **SKIP**, so this is compatibility evidence, not a live call.

The initial full worker run hit a new persistence-test fixture omission (receipt storage lacked a
stub). That fixture was corrected. The final worker run passed after also verifying that chat-mode
credential degradation cannot activate conversational generation hints. The pre-existing member-session skip remains separate from passing checks.

## Real combined calibration

```bash
uv run --directory worker python -m worker.decisions.probe \
  --question-set both --threshold 0.9 --conversation-threshold 0.8
```

`--question-set conversation` sends only the reply question. `--fixture` accepts another labelled
JSON file; use `expected_reply`, `expected_scope`, `history`, `question`, `persona_identity`, and
unique `id` fields as in `worker/tests/fixtures/decisions/conversation.json`. The bundled fixture
copy permits probing from a worker image. Custom configured choice/identity values require matching
fixture values. Threshold flags evaluate candidates; they never activate routing or generation.
The probe performs no Engram operations or conversation/private-memory writes.

[Captured reports](evidence/decisions-conversation-2026-10-10.json): 14 proposed cases, two named
questions per request, `gpt-6-luna`, SDK 3.28.0, 1.5-second budget, zero SDK retries. Cases cover social
replies, facts, emotional disclosures, mixed requests, corrections, quoted dialogue, ambiguous turns,
and confirmations whose meaning depends on history. Labels still need Tauqueer's review.

Initial combined run, scope candidate 0.7 / acknowledge 0.8:

- 28/28 valid named answers; 13/14 effective reply-policy matches, one conservative answer,
  **zero unanswered-request mistakes**.
- Scope: eight matches, four conservative both choices, **two incorrect narrowings** versus proposed
  labels (emotional disclosure and quoted-dialogue question), confidence 0.88 and 0.89 respectively.
- Duration range 130.65–825.17 ms. This exposed limits of the initial scope-only calibration.

Stricter combined run, scope candidate 0.9 / acknowledge 0.8:

- 28/28 valid answers; 13 reply matches and one conservative answer; **zero unanswered requests**.
- Scope: eight matches and six conservative both choices; **zero incorrect narrowing** in this run.
- Duration range 131.76–752.67 ms. Both prompts/question definitions have their hash in the report.

These are candidate policies, not approved production thresholds. No confidence value is written to
`.env` or defaults. Fourteen synthetic cases and one repeat cannot establish broad quality or device
latency; review representative product cases before active use. Keep the first run's failures visible.

## Latency gate

The current `npm run budgets` still fails on the two existing retrieve samples: p50 **5,045 ms**
versus **4,000 ms**; p90 **6,113.8 ms** passes its **8,000 ms** budget. Those samples are not new
paired feature-off/both-active turns. The failed gateway budget stage prevents the later Engram-log
stage from running. No new product/first-word measurements were fabricated from classifier timings.
Capture equivalent fresh turns, correlation ids, first-token/first-word timing and `scope_wait_ms`
for each flag configuration. Compare only identified new samples; the existing aggregate groups by
brain mode and cannot distinguish feature configurations. Keep this gate open until measured.

## Manual sitting and independent rollback

Start in `/chat` with a published persona and a known authenticated caller; then use Aura and Fish
on a real device. Begin with `CONVERSATION_DECISIONS_MODE=shadow` and restart the worker.
If `LOG_TURN_FIELDS` is set explicitly, append:
`reply_requested,reply_mode,reply_reason,reply_confidence,conversation_mode,reply_candidate,reply_candidate_reason`
as well as the scope timing fields from Phase 1. Off/shadow do not pass a generation hint.

After Tauqueer approves the labels/thresholds, set the approved
`CONVERSATION_DECISIONS_MIN_CONFIDENCE` and `CONVERSATION_DECISIONS_MODE=active`, then restart.
If enabling both new features, use Decisions scope backend and its approved scope threshold too.
Do not treat the preliminary 0.7 scope-only candidate as validated across these new conversation cases.

1. Say thanks, state a caller fact, correct it, and share an emotional disclosure. Judge whether the
   acknowledgments are brief, appropriate and in persona voice, without claiming a memory write.
2. Ask a factual question and a statement-plus-question; verify the request is answered. Test a short
   confirmation that accepts a request from history and a quoted question that is not the caller's intent.
3. Check unknown facts and selected empty pools remain honest; use a second caller/persona for isolation.
4. Let a new fact's background write finish, end the sitting and reopen it; check private recall.
5. Repeat in Aura/Fish. Interrupt both an acknowledgment and an answer; confirm the next turn works.
6. Test classifier failure separately from Engram failure: the former uses ordinary answering and both
   authorized lists; the latter retains existing failure handling. Capture paired first-word evidence.
7. Roll back only conversation with `CONVERSATION_DECISIONS_MODE=off`, restart and verify ordinary
   answer behavior while scope routing stays configured. Disable the scope master switch too to restore
   the baseline. Conversation has no scope-master dependency, so both flags must be off for full baseline.

Follow the [complete manual checklist](../plans/openai-decisions.md#part-25--manual-sitting-independent-rollback-and-closeout).
Under [AGENTS.md](../../AGENTS.md), the phase is not done before that sitting passes. No new ADR
is Accepted by this implementation; closeout/owner approval remains pending.
