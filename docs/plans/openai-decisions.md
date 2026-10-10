# Plan — OpenAI Decisions for memory routing and conversational replies

Owner: Tauqueer. Written 10 Oct 2026 against the current code on `main`.
**Both phases have code implemented; threshold, latency, and manual acceptance remain open.**

Tauqueer authorized all Phase 1 code on 10 Oct 2026. Parts 1.1–1.3 passed their automated
checks and were committed separately. Part 1.4 code and classifier calibration evidence are
ready; paired feature-off/active first-word measurements remain pending. Part 1.5 requires
Tauqueer's manual sitting and threshold approval. The feature remains disabled; `.env` was
not changed. Do not mark Phase 1 accepted from this status. Tauqueer subsequently authorized Phase 2 code
before its manual sitting; that authorization does not waive either phase's activation gates.
Phase 2 validation and manual handoff: [conversational decisions](../tests/decisions-conversation.md).

Evidence and the manual handoff: [routing validation](../tests/decisions-memory-routing.md).
The original planning document and its docs-index changes remain uncommitted; they were not
included in the implementation part commits.

## Scope and order

1. **Phase 1 — Memory routing.** Use Decisions to choose persona shared memory, caller private
   memory, or both. Preserve parallel retrieval and the structural isolation filter.
2. **Phase 2 — Conversational decisions.** Use Decisions to choose **answer** or **acknowledge**
   for an otherwise eligible reply. The speaking model still produces the utterance.

The first conversational version does not choose when a speaker has finished, suspend a call,
or resume after a model-selected wait. That requires a separate conversation lifecycle design.
The two other ideas — memory validation and quality evaluation — stay in the future section.

The original order required Phase 1's sitting before Phase 2. Tauqueer explicitly authorized
Phase 2 code with that sitting still open; active rollout still requires both manual checklists. The existing
[voice-audio](voice-audio.md) and [caller-memory](caller-memory.md) plans remain open; this plan
does not complete their outstanding work. Accepted decision records remain in force, particularly
[caller facts](../decisions/0009-private-is-extracted-caller-facts.md) and
[simple spoken output](../decisions/0013-spoken-output-stays-simple.md).

## Implementation baseline (before this change)

Read these files before coding. Names below refer to the current implementation, not new APIs:

- `worker/src/worker/engram/scope_router.py`: `ScopeRouter.decide(question)` uses Chat Completions
  JSON output and returns `ScopeDecision(scope, reason)`. It receives the current utterance only.
- `worker/src/worker/engram/scope_defaults.py`: the current scope prompt and template rendering.
- `worker/src/worker/turn/service.py`: `TurnRunner` owns separate read, router, and writer pools.
  `_retrieve_grounded` starts classification beside the two scoped reads, filters rows through
  `may_ground`, then applies scope. `_decision_after_scope` lets a narrowed empty pool produce an
  honest answer without borrowing the other pool. `TurnPlan`, `stream_speak`, and `finish` carry
  the reply through generation, persistence, and write-back.
- `worker/src/worker/engram/tenant.py`: `may_ground` is the structural permission check.
- `worker/src/worker/controller/controller.py` and `decision.py`: input presence, brain errors,
  and deliverable results determine `speak` or `silence`. This controller does not make a
  conversational classification call today.
- `worker/src/worker/reframe/answerer.py` and `defaults.py`: the retrieve brain streams a reply
  grounded in persona identity, the two labelled memory lists, and speaker-labelled sitting history.
- `worker/src/worker/reframe/reframer.py`: the alternate chat brain rewrites Engram's composed
  reply. `BRAIN_MODE=chat` stays off; this plan initially targets the retrieve brain.
- `worker/src/worker/engram/caller_facts.py` and `closing.py`: per-turn and hang-up extraction
  already run off the reply path. This plan does not replace them.
- `worker/src/worker/clients.py`: the speaking client may use `OPENAI_BASE_URL` or
  `OPENAI_API_BASE_URL`. An OpenAI-compatible Chat Completions provider does not necessarily
  implement `/v1/decisions`.
- `worker/src/worker/config.py`, `.env.example`, `worker/pyproject.toml`, and `worker/uv.lock`:
  runtime configuration and dependencies. The baseline lock pinned OpenAI Python to `3.6.0`; it now pins `3.28.0`.
- `worker/src/worker/persistence/turns.py` and `observe/fields.py`: turn persistence and the log
  allowlist. `controller_reasons` already stores scope metadata; `Decision.hints` is not persisted
  automatically.

Existing tests to extend: `worker/tests/test_scope_router.py`, `test_turn.py`, `test_controller.py`,
`test_config.py`, `test_reframe.py`, and `test_chat_completions.py`. Phase 1 adds adapter, context, turn integration, and probe tests. Phase 2 now adds conversational policy, combined-turn, generation, persistence/extraction, and probe tests.

## Provider contract to verify before implementation

Checked against official OpenAI documentation on 10 Oct 2026:

- The dedicated endpoint is `POST /v1/decisions`; the documented model is `gpt-6-luna`.
- Requests contain `model`, `input`, and named `questions`. A `choice` question supplies the
  allowed values and descriptions; returned answers identify their question by `name`.
- Choice answers include `choice`, `probabilities`, and `confidence`; an answer can be a refusal.
  Confidence and the selected option's probability are separate fields.
- Independent questions can share one request. Decisions does not generate the spoken reply or
  extracted fact text.
- The guide's Python examples require OpenAI SDK `3.26.0` or later. The API is in public beta;
  verify the installed SDK and account access before depending on it.

Sources: [Decisions](https://developers.openai.com/api/docs/guides/decisions),
[choice answers](https://developers.openai.com/api/docs/guides/decisions#select-from-fixed-options),
[multiple questions](https://developers.openai.com/api/docs/guides/decisions#ask-multiple-questions),
and [confidence calibration](https://developers.openai.com/api/docs/guides/decisions#interpret-the-answers).

Context7 is not connected in the session that wrote this plan. The provider facts above were
checked through the official OpenAI documentation connector. At implementation time, follow
AGENTS.md's Context7 setup rule and recheck the current provider contract. The advertised API
speedup is not an end-to-end voice latency measurement for this bot.

## Rules for both phases

- All language understanding comes from model outputs. Examples in this plan are evaluation
  cases, never phrase lists, regexes, pronoun rules, or intent branches in application code.
- Model selection, prompts, choice descriptions, confidence thresholds, deadlines, input caps,
  modes, and metadata keys come from config. API schema field names are provider contracts.
- Validate the local session, caller, published persona, quotas, and subscriptions before issuing
  a Decisions request. Build history from that validated sitting, not client-supplied history.
- Classification never changes credentials or grants access. Filter every retrieved row through
  `may_ground` before scope can remove a list. A member without their own Engram credential
  remains shared-only.
- Engram remains the memory store, Postgres the transcript, and the speaking model the generator.
  Deepgram/Aura and Fish retain their existing transport and cancellation paths.
- Keep the public Chat Completions-compatible BYO endpoint and the existing `speak` / `silence`
  response actions. Decisions is an internal worker dependency, with server-side credentials.
- Scope uncertainty keeps both authorized lists. Conversational uncertainty uses normal answer
  behavior. Neither fallback can override a structural refusal or an Engram failure.
- A timeout, refusal, invalid answer, or unavailable classifier must not trigger a second model
  request on the reply path. Record a bounded reason code and use the local fallback.
- Raw inputs, sitting history, memory contents, provider response bodies, and secrets stay out of
  classifier logs. This includes exception strings that might contain request data.
- Features ship disabled. Shadow mode evaluates without affecting a reply. Use active mode in
  the test environment for the manual sitting; enable it in normal deployment only after labelled
  evaluation and Tauqueer's sitting pass.

## Proposed internal shape

Keep provider decoding separate from product policy. A small `worker.decisions` package should
provide a shared client, context builder, typed results, and prompts. Scope and conversational
code consume normalized results rather than inspecting SDK objects in `TurnRunner`.

Suggested contracts, with final names chosen in Part 1.1:

- `DecisionContext`: current question, bounded speaker-labelled history, persona identity,
  and a small validated app-state object. No retrieved memories or Engram credentials.
- `ChoiceResult`: question name, chosen value, confidence, option probabilities, and an explicit
  outcome such as success, timeout, refusal, malformed, unavailable, or saturated.
- `DecisionBundle`: optional memory-scope result, optional reply-mode result, and request timing.
  The bundle belongs to one turn and correlation id; never cache it by persona or question alone.
- `ScopeDecision(scope, reason)` remains the interface used by the existing scope application
  code. Convert a valid provider choice to it and derive the reason locally from configured values.
- Phase 2 adds a reply-mode result to `TurnPlan`. Both answer and acknowledge still use
  `Action.SPEAK` when the controller allows speech; reply mode is a separate generation hint.

Use named answer lookup. Array order must not connect a scope answer to a conversational question.
Never obtain a generated reason string from Decisions; the application maps typed outcomes and
choices to its configured reason codes.

Worker source paths abbreviated in the part lists below are relative to `worker/src/worker/`;
test paths abbreviated there are relative to `worker/tests/`. New modules and fixtures must also
be included in the worker coverage configuration so the existing coverage gate covers them.

Check commands, from the repository root:

```bash
npm run test:worker
uv run --directory worker ruff check src
npm run typecheck
npm run lint
npm test
```

`npm test` includes the worker suite; it replaces a separate worker run at a full-suite checkpoint.
For a fast targeted check, use `uv run --directory worker python -m pytest --no-cov tests/<file>`;
the full worker run still needs to pass its configured coverage gate. Live probes are listed in
the relevant parts and require the existing configured services.

## Phase 1 — Memory routing

Goal: replace the existing scope classification request with Decisions, include enough sitting
context for follow-ups, and preserve the retrieval window and isolation rules.

### Part 1.1 — Define the contract, configuration, and dependency

Files: `worker/src/worker/config.py`, `worker/src/worker/clients.py`, `.env.example`,
`worker/pyproject.toml`, `worker/uv.lock`, and `worker/tests/test_config.py`.

Subparts, in order:

1. Verify current SDK support for `client.decisions.create`. Set an explicit compatible minimum
   in `pyproject.toml` and update the uv lock. Run existing OpenAI tests to catch changes in the
   speaking, reframing, and extraction clients; do not migrate those calls to another API.
2. Define a dedicated Decisions client. Proposed env keys: `DECISIONS_API_KEY` (optional,
   falling back to `OPENAI_API_KEY`), `DECISIONS_BASE_URL` (optional, SDK's official default when
   unset), and `DECISIONS_MODEL` (documented model as the config default). It must not inherit a
   custom speaking-model base URL implicitly. Reuse warm connections and close the owned client.
3. Add `ENGRAM_SCOPE_ROUTER_BACKEND` with `chat_completions` and `decisions`. Preserve the current
   backend as the default and retain it for an explicit rollback. Add `DECISIONS_SCOPE_MODE`
   (`off`, `shadow`, `active`), default off. The existing `ENGRAM_SCOPE_ROUTER_ENABLED` remains
   the master scope switch; false means no scope question or narrowing.
4. Add `DECISIONS_TIMEOUT_SECONDS`, `DECISIONS_MAX_RETRIES` (default zero on this reply path),
   `DECISIONS_MAX_IN_FLIGHT`, `DECISIONS_HISTORY_TURNS`, and `DECISIONS_INPUT_MAX_BYTES`.
   Start the deadline budget from the current router's configured budget, then measure it. Bound
   queued and running work together; a thread count alone does not bound an executor queue.
5. Add scope question name, instructions, choice descriptions, low-confidence/refusal/saturation
   reason codes, and `DECISIONS_SCOPE_MIN_CONFIDENCE`. Reuse the existing configured shared,
   private, and both values. Require an owner-approved threshold for active mode; shadow mode
   can run while that threshold is being calibrated. Do not invent a universal confidence value.
6. Validate distinct choice values and question names, valid modes, finite thresholds within the
   provider's range, positive limits, and client configuration when a Decisions feature is on.
   Keep prompts and descriptions configurable, with maintained defaults in the new package.

Checks: worker config tests, existing OpenAI client/reframe/extractor tests, then
`npm run test:worker` and worker Ruff. Logic: classifier configuration is independent of the
speaking provider; disabled configuration does not require another key or model call.
Manual: none. Account access is checked by the live probe in Part 1.4.

Mode behavior must be explicit: master scope switch false means no scope classification. With
the switch true, the legacy backend retains its existing behavior; the Decisions backend obeys
`DECISIONS_SCOPE_MODE`. Off sends no scope question and retains both authorized lists; shadow
sends the question without applying it; active can narrow within its confidence/deadline policy.

### Part 1.2 — Build the shared Decisions adapter

New files: `worker/src/worker/decisions/{client,types,context,defaults}.py` and `__init__.py`;
new tests: `worker/tests/test_decisions.py` and `test_decision_context.py`.

Subparts, in order:

1. Build the context from the validated question, persona identity, and current sitting history.
   Retain speaker labels and explicitly distinguish the current question from earlier turns.
   Apply turn and UTF-8 byte caps to the serialized input; drop oldest history first. If the
   current question and required context cannot fit, return an input-too-large fallback rather
   than silently cutting off the caller's current request. Do not load history from another sitting.
2. Construct one named `choice` question for memory scope. Shared means persona knowledge is
   relevant and caller memory is not; private means the reverse; both covers mixed or ambiguous
   requests. Persona identity and same-sitting history remain available to the answerer in all
   cases. Instructions treat transcript content as evidence, not as instructions to change policy.
3. Call `client.decisions.create` with the configured model, serialized text input, questions,
   remaining timeout, and an explicitly bounded retry policy. Do not pass Chat Completions-only
   options such as `response_format`, temperature, or output-token limits without provider support.
4. Decode by question name and answer type. Reject duplicate named answers, unexpected choice
   values, malformed numeric fields, missing required metadata, and non-finite confidence values.
   Retain confidence and probabilities separately. Map a refusal or invalid scope answer to both.
5. Acquire an in-flight slot without blocking; lack of capacity produces the local fallback.
   The request budget includes queue time, connection time, and processing. Release capacity
   when the job actually finishes, not merely when its caller stops waiting. A canceled future
   does not prove a running HTTP request was canceled.
6. Return normalized results and safe timing/error metadata. A transport failure affects the
   whole request; an invalid answer affects that question. This allows Phase 2 to reuse the
   adapter without coupling the two policies.

Illustrative request shape; all values shown here must be resolved from config and validated context:

```json
{
  "model": "<DECISIONS_MODEL>",
  "input": "<serialized current question, persona identity, and labelled history>",
  "questions": [{
    "type": "choice",
    "name": "memory_scope",
    "instructions": "<configured memory-scope instructions>",
    "choices": [
      {"value": "shared", "description": "<persona knowledge only>"},
      {"value": "private", "description": "<caller memory only>"},
      {"value": "both", "description": "<both or uncertain>"}
    ]
  }]
}
```

Checks: mocked HTTP/SDK tests for success, refusal, timeout, authentication failure, throttling,
server failure, malformed answers, duplicate names, reordered answers, input caps, and capacity
exhaustion; run worker tests and Ruff. Confirm one attempt with zero SDK retries.
Manual: none. These tests prove request handling, not real classification quality.

### Part 1.3 — Integrate scope decisions beside retrieval

Files: `engram/scope_router.py`, `engram/scope_defaults.py`, `turn/service.py` under worker `src`,
and `worker/tests/test_scope_router.py`, `test_turn.py`, and `test_tenant.py`.

Subparts, in order:

1. Preserve the legacy backend behind the explicit backend setting. The Decisions implementation
   accepts the new context and maps results back to `ScopeDecision`; no automatic legacy-model
   fallback occurs after a Decisions failure.
2. Pass the already loaded sitting history and persona identity into `_retrieve_grounded`.
   Start the request only after local validation and the existing membership/credential setup,
   alongside the existing shared/private reads. Never run it before retrieval as a prerequisite
   to choosing which pool to fetch.
3. Keep `_ground_retrieve` and `may_ground` unconditional. Apply only the normalized scope after
   filtering. A model cannot admit a dropped row, select another caller, or invent a tenant.
   Uncredentialed members skip the scope question and stay shared-only.
4. In shadow mode, keep both authorized lists and do not wait for the classifier. Record its
   result asynchronously with the captured correlation id; do not depend on the main thread's
   ambient logging context. In active mode, wait only for the remaining absolute deadline.
5. Confidence below the configured threshold, timeout, refusal, input overflow, saturation, or
   an invalid value keeps both authorized lists. Late completion must not mutate a `TurnPlan`,
   start a second utterance, or alter an already emitted reply.
6. Preserve `_decision_after_scope`: an empty selected pool gets the existing honest-answer
   treatment; it must not be filled from the discarded pool. Keep receipts, private extraction,
   closing passes, and the sitting's Engram session identity intact.

Checks: fixture-driven turn tests prove concurrent start and bounded wait; use synchronization
or a controlled clock, not fragile wall-clock sleeps. Cover both/one/empty lists, disabled mode,
shadow mode, a slow classifier, unauthorized rows, missing member credentials, and two simultaneous
callers/personas. Run worker tests, isolation, and security in a capable environment.
Manual: none until Part 1.5. Active routing is not a production default after this part.

### Part 1.4 — Add evidence, calibration, and a live probe

Files: `turn/service.py`, `observe/fields.py`, `config.py` under worker `src`, existing log config
in `.env.example`; new `worker/src/worker/decisions/probe.py`; fixtures under
`worker/tests/fixtures/decisions/`; `docs/tests/README.md` when the probe actually exists.

Subparts, in order:

1. Extend the log allowlist with backend, mode, chosen scope, fallback reason, confidence,
   request duration, and time spent waiting after retrieval. Keep correlation and session ids.
   Persist configured scope/fallback reason codes through the existing `controller_reasons`
   path. Do not assume `Decision.hints` or a new log field is automatically persisted.
2. Add a read-only live classifier probe, invokable as
   `uv run --directory worker python -m worker.decisions.probe`. It uses curated, non-identifying
   fixture text and reports actual `/decisions` access, model support, named-answer parsing, and
   duration. Missing credentials report SKIP, not evidence of access. It does not teach a persona,
   create a sitting, write private facts, or print an API key or full provider response.
3. Label cases for persona questions, caller recall, mixed questions, no context, ambiguous
   follow-ups, corrections, and quoted speech. Include history-dependent cases, not only obvious
   pronouns. Expected scope is hand-reviewed; mocks do not prove that the model agrees.
4. Evaluate the actual API on those cases. Choose a threshold that favors both when the cost of
   discarding useful memory is high. Report incorrect narrowing separately from harmless both
   choices. Record the prompt version, model, threshold, sample count, and observed failures.
5. Compare representative feature-off and active turns using trace/correlation ids, equivalent
   personas and questions, and the configured first-word budgets. `npm run budgets` can pass
   with no samples and aggregates by brain mode; neither no samples nor mixed old/new runs
   establishes this change's latency. Capture classifier overrun separately from retrieve time.

Checks: worker tests, log redaction tests, real read-only classifier probe, and relevant existing
chat/BYO and budget probes. Record SKIP and environment blockers honestly.
Manual: none; device and product quality checks are in Part 1.5.

### Part 1.5 — Manual sitting, rollback, and documentation

Tauqueer runs this after the automated checks. Use a published persona with known shared knowledge
and a caller with real private credentials. Enable active routing only in the test environment with
the calibrated configuration.

Test configuration progression, after the client/key/model settings from Part 1.1 are filled:

```dotenv
ENGRAM_SCOPE_ROUTER_ENABLED=true
ENGRAM_SCOPE_ROUTER_BACKEND=decisions
DECISIONS_SCOPE_MODE=shadow
```

After Tauqueer approves a threshold (initial scope-only candidate `0.7`; newer combined
cases require review and favor the stricter `0.9` candidate), set
`DECISIONS_SCOPE_MIN_CONFIDENCE` and change scope mode to `active` for
this sitting. Restart/redeploy the worker to load env changes; do not assume the running settings
reload automatically. This is test activation, not a change to `.env.example`'s disabled defaults.

Manual checklist:

- [ ] Ask about the persona's work: routing and answer attribution use the persona pool.
- [ ] Ask about a known caller fact: routing uses private memory; the persona does not claim it.
- [ ] Ask how the persona's experience relates to the caller's project: both pools remain available.
- [ ] Ask a short follow-up whose subject is clear only from sitting history; routing follows it.
- [ ] Correct a caller fact during the sitting; the answer respects the current correction.
- [ ] Ask for an unknown caller fact; an empty selected list does not borrow the persona's biography.
- [ ] Hang up, start a new sitting, and confirm existing extracted-fact recall still works.
- [ ] Repeat representative questions in `/chat`, an Aura call, and a Fish call if a real Fish
      persona/key is available. Provider-specific SKIP is an outstanding manual check.
- [ ] Use a second caller and a second persona to confirm the selected lists stay isolated.
- [ ] Compare observed first-word delay and traces with feature-off behavior; budgets have samples.
- [ ] Force a classifier failure through a local test configuration or stub: authorized memory
      remains usable and there is no extra reply-path model retry.
- [ ] Disable `ENGRAM_SCOPE_ROUTER_ENABLED` and confirm the current both-pool path returns.

After success: update this plan's evidence/status, `docs/progress.md`, and the memory-routing
sections of `docs/architecture.md` and `docs/architecture/memory.md`. Record the measured threshold,
fallback, and deployment configuration. Revisit Proposed ADR 0006 with Tauqueer; do not silently
mark it Accepted. If a locked choice must change, write the appropriate new decision record.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, worker Ruff,
`npm run isolation`, `npm run security`, `npm run failures`, and `npm run budgets` with real samples.
Manual: required, checklist above. Phase complete only after Tauqueer records the result.

## Phase 2 — Conversational decisions

Implementation status (10 Oct 2026): Parts 2.1–2.3 code and tests implemented; Part 2.4
probe/logging and synthetic calibration implemented. Final automated evidence is in the
[validation handoff](../tests/decisions-conversation.md). Real product/first-word comparisons,
owner-approved labels/thresholds, and Part 2.5 manual sitting remain open. No active defaults,
`.env` changes, UI changes, wait mode, or transport changes. The phase is not marked accepted.

Goal: make a successful turn answer the caller when an answer is needed, and acknowledge naturally
when a brief acknowledgment is enough. This is a response-mode policy, not a new audio state machine.

### Part 2.1 — Define answer versus acknowledge

Files: new `worker/src/worker/decisions/conversation.py`, shared types/defaults/context,
`worker/src/worker/config.py`, `.env.example`, and labelled conversation fixtures.

Subparts, in order:

1. Add `CONVERSATION_DECISIONS_MODE` (`off`, `shadow`, `active`), default off, and configured
   question name, answer/acknowledge values, choice descriptions, prompt, payload hint key,
   fallback reason codes, and `CONVERSATION_DECISIONS_MIN_CONFIDENCE`.
   Require a calibrated, owner-approved threshold before active mode, as with scope narrowing.
2. Define **answer** as responding to a request for information, explanation, advice, clarification,
   or any ambiguous turn. Define **acknowledge** as briefly receiving the caller's statement,
   correction, or social response when it requires no substantive answer. These are model
   instructions, not string checks. An acknowledgment must not promise an unconfirmed memory write.
3. Make acknowledgment conservative. A turn that contains both a personal statement and a
   question must answer the question. A correction followed by a request must answer the request.
   A short confirmation can authorize the next action discussed in history; it is not automatically
   a social acknowledgment. Low-confidence acknowledge becomes answer.
4. Define fallback: normal answer mode with a reason. Preserve existing controller decisions for
   empty input, errors, and empty results, including the existing narrowed-empty exception.
   Neither mode can revive a structurally refused turn or turn an Engram failure into speech.
5. Use current question, bounded labelled history, persona identity, and validated app state as
   evidence. Do not use private memory contents, classifier results, audio amplitude, or guesses
   about whether a speaker is still talking as inputs to this choice.

Checks: config validation and normalized-result tests; labelled cases for social replies, factual
statements, emotional disclosures, mixed requests, corrections, quoted dialogue, and confirmations
that depend on prior history. Establish labels with Tauqueer before active use; real model accuracy
is evaluated later rather than asserted in a mocked unit test.
Manual: none. The initial choice is answer/acknowledge; adding wait is a new named design task.

### Part 2.2 — Reuse one request and one deadline per turn

Files: shared adapter/context, `turn/service.py`, and new/extended Decisions and turn tests.

Subparts, in order:

1. Extend the per-turn request builder with an independent reply-mode `choice` question. When
   Decisions scope routing and conversational classification both run, send both questions in
   one request. Their instructions must not require either question's answer as input.
2. Construct only enabled questions: scope only; conversation only; both; or none. The existing
   scope master flag and member-credential gate apply only to the scope question. Conversation
   classification can run on a shared-only member's validated retrieve turn without widening memory.
   Initially skip conversational classification for `BRAIN_MODE=chat`, with an explicit reason.
3. Launch the bundle alongside retrieval. Preserve one absolute deadline, one capacity slot,
   and one SDK request; do not call separate classifiers serially. A legacy scope backend used
   for rollback may retain its old call, but active deployment of both new features uses Decisions.
4. If either question is active, wait only within the remaining deadline, then apply each mode's
   policy separately. If all questions are shadow, never wait. A missing, refused, or malformed
   scope answer does not erase a valid reply-mode answer, and vice versa.
5. Keep results local to the originating `TurnPlan`. Ignore late choices after the deadline or an
   aborted turn. Preserve the existing gateway/browser interruption path; Python future cancellation
   alone must not be described as cancellation of an already running provider request.

Checks: request-count assertions, every feature-mode combination, reordered named answers,
per-question failure, shared-only callers, chat-mode skip, capacity exhaustion, and active/shadow
combinations. Test multiple simultaneous callers/personas and stale results. Run worker tests/Ruff.
Manual: none until Part 2.5; no activation default changes here.

### Part 2.3 — Carry reply mode into the speaking model

Files: `controller/decision.py` and `controller/controller.py` only where policy composition needs
them; `turn/service.py`, `reframe/answerer.py`, `reframe/defaults.py`, `config.py` under worker `src`;
`worker/tests/test_controller.py`, `test_turn.py`, `test_reframe.py`, and `test_chat_completions.py`.

Subparts, in order:

1. Obtain the existing controller result first, including `_decision_after_scope`. Apply the reply
   mode only to a speak-eligible retrieve turn. Keep the structural reason codes; add conversational
   metadata separately rather than replacing errors or inventing `Action.ACKNOWLEDGE`.
2. Add an optional configured reply-mode hint to the answerer payload and both blocking/streaming
   call paths. Feature off omits the hint and retains the current request/prompt behavior. Shadow
   records the candidate mode without passing it to generation. Test configured prompt overrides;
   active mode requires the maintained reply-mode instructions to reach the speaking model even
   when `ANSWER_SYSTEM_PROMPT` is customized.
3. Define acknowledge as a brief natural response to what the caller actually said, preserving
   persona style and appropriate tone. Do not add an unrelated biography, advice, follow-up question,
   claimed durable storage, or invented fact. The speaking model generates it; no canned phrase list.
4. Define answer as the normal grounded response. Keep identity, persona-memory, caller-memory,
   current-question, and sitting-history attribution rules. Short replies remain prompt-controlled;
   reply mode must not weaken grounding or introduce word-count/keyword understanding logic.
5. Keep token streaming, one Fish flush per utterance, and current browser playback. Do not add
   a second speaking-model call, pre-generate an acknowledgment, or change Fish/Aura selection.
6. Keep persistence and caller-fact extraction on successful acknowledged turns. Acknowledging
   a new caller fact must not stop the existing per-turn or closing extractor from seeing the
   exchange. Store the actual generated utterance, not a mode label, as persona transcript text.

Checks: blocking/streaming parity, feature-off payload compatibility, customized system prompts,
acknowledge/answer hint propagation, structural refusal precedence, narrowed-empty behavior,
write-back receipts, extraction after acknowledgment, and BYO stream compatibility. Run worker
tests, typecheck, lint, and the applicable offline failure/barge-in probes.
Manual: none until Part 2.5. No UI or transport change is planned; if implementation adds one,
browser verification becomes required under AGENTS.md.

### Part 2.4 — Trace, evaluate, and verify failure behavior

Files: `turn/service.py`, `observe/fields.py`, `config.py`, Decisions probe and fixtures,
existing controller/turn/transport tests; `.env.example` and `docs/tests/README.md` as needed.

Subparts, in order:

1. Record requested/applied reply mode, confidence, shadow versus active status, fallback reason,
   and shared request timing through the allowlist. Persist bounded mode/reason metadata via
   `controller_reasons`, just as scope metadata is persisted today. Do not log a free-form rationale.
2. Extend the real classifier probe with conversation cases and mixed-question requests. Calibrate
   acknowledge confidence from labelled examples, reporting unanswered-request mistakes separately
   from extra answers. Record sample count and errors; do not equate confidence with correctness.
3. Exercise off, scope-only, conversation-only, both active, and shadow combinations. A Decisions
   outage keeps both authorized pools and normal answer behavior. Auth, quota, Engram, or TTS
   failure retains its existing product handling; the classifier cannot override it.
4. Compare feature-off versus both-active first-word measurements and classifier overrun. Verify
   one Decisions request and one generation stream per eligible turn. Handle feature flags
   independently, so conversation can be rolled back while keeping proven memory routing.
5. Run existing isolation/security/failure probes in a capable environment. Check that classifier
   payloads and logs cannot include another sitting or member's history, and that no provider key
   or extra classifier API is exposed through the browser or public BYO shim.

Checks: complete automated suite, Ruff, real classifier probe, applicable chat/BYO/voice probes,
and budgets with samples. SKIP, no samples, and blocked checks remain outstanding evidence.
Manual: none until Part 2.5.

### Part 2.5 — Manual sitting, independent rollback, and closeout

Tauqueer runs `/chat` first, then voice on a real device. Use the calibrated active configuration
and compare representative turns with conversation mode off.

Keep Phase 1's separately approved scope settings; its acceptance is still pending. Begin with `CONVERSATION_DECISIONS_MODE=shadow`; after
Part 2.4 establishes `CONVERSATION_DECISIONS_MIN_CONFIDENCE`, set that mode to `active` and
restart/redeploy the worker for this sitting. Keep feature-off comparison runs separate in evidence.

Manual checklist:

- [ ] A social response receives a natural brief acknowledgment rather than an unrelated explanation.
- [ ] A factual question receives an answer, with the same memory grounding as Phase 1.
- [ ] A caller statement containing a question gets the question answered.
- [ ] A correction is received naturally, and the next reply uses the corrected same-sitting context.
- [ ] A short confirmation of an earlier question/request is interpreted using sitting history.
- [ ] An emotional disclosure is acknowledged appropriately, rather than mechanically dismissed.
- [ ] A brand-new caller fact still reaches the existing background extractor and is recalled in a
      later sitting after its write completes. Acknowledgment alone does not claim it was saved.
- [ ] Unknown facts and empty selected pools produce honest behavior, without borrowing biography.
- [ ] Repeat in an Aura call and a Fish call with real credentials; voice identity and streaming remain
      clean. Interrupt an acknowledgment and an answer, then confirm the next turn works normally.
- [ ] Simulate classifier timeout/refusal: ordinary answer behavior continues with authorized memory.
- [ ] Simulate an Engram failure separately: conversational classification does not bypass it.
- [ ] Set `CONVERSATION_DECISIONS_MODE=off`: current answer behavior returns while proven scope
      routing remains active. Then disable scope routing as well and verify the baseline path.
- [ ] Trace metadata explains the applied choice, fallback, and latency; logs contain no input text.
- [ ] First-word budget checks contain representative new samples and pass.

After success: update this plan, `docs/progress.md`, the controller/answerer sections of
`docs/architecture.md`, and `docs/tests/README.md`. Add a decision record for the new response-mode
policy with Tauqueer's approval; do not rewrite Accepted records or describe the feature as shipped
before the manual sitting. Keep unperformed provider/device checks visibly open.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, worker Ruff,
`npm run isolation`, `npm run security`, `npm run failures`, `npm run bargein`, and
`npm run budgets` with real samples. Manual: required, checklist above.

## Rollback and evidence rules

- Stop memory narrowing: `ENGRAM_SCOPE_ROUTER_ENABLED=false`. Restore the legacy classifier
  only by deliberately selecting its backend and its existing configuration.
- Stop conversational policy: `CONVERSATION_DECISIONS_MODE=off`. It must not disable memory
  routing or caller-fact extraction. With all Decisions questions disabled, no request is made.
- Rollback uses ordinary configuration/deployment, never a private-pool purge or transcript edit.
- Track each part as not started, implemented/automated checks passed, manual pending, or complete.
  Record date, commit once authorized by the working loop, commands/results, model/prompt settings,
  and manual evidence. Never turn a provider SKIP or an environment blocker into a passing result.
- Parts with Manual: none can complete after their automated and logic checks. Parts 1.5 and 2.5
  are the phase-end live gates; earlier parts do not establish full product behavior.

## Future options — retained, not implementation phases

**Memory validation.** Evaluate candidate facts already produced by `CallerFactExtractor`: whether
the caller actually stated them, whether attribution is correct, and whether they are durable.
Run it off the reply path before private admission. Keep the generative extractor; Decisions cannot
write the fact text. Define calibration, false-rejection handling, and failure behavior in a new
named plan before adding a gate that could discard useful caller memory.

**Persona and memory quality evaluation.** Score recorded or curated replies for grounding,
caller/persona attribution, conversational appropriateness, and speaking style. Use this to compare
prompts and models outside live calls. Speaker-labelled evidence and clear rubrics are required;
model scores are supporting evidence, not proof of factual correctness or security.

**Later conversational waiting.** If Tauqueer wants answer/acknowledge/wait, first define the resume
signal, cancellation rules, typed-chat behavior, maximum wait, visible call state, and how final STT
events relate to the decision. Neither waiting nor echo suppression can be inferred reliably from
the current question alone. Keep that design separate from this first response-mode implementation.

None of these starts automatically when the two phases finish.
