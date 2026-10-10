# Decisions memory-routing validation and manual handoff

Date: 10 Oct 2026. Scope: Phase 1 of [the implementation plan](../plans/openai-decisions.md).
Code is implemented. The phase is **not accepted or enabled**: the owner sitting, threshold
approval, and paired first-word measurements remain open. Phase 2 was subsequently authorized; see the later combined-request evidence below.

## Implementation

- Dedicated `client.decisions.create` client, SDK minimum 3.26.0, lock 3.28.0. The client explicitly
  uses the official endpoint when `DECISIONS_BASE_URL` is unset, even if the speaking provider's
  `OPENAI_BASE_URL` is exported. Key selection is Decisions key then OpenAI key. SDK retries are zero.
- Immutable, bounded context: current question, speaker-labelled sitting history, catalog identity,
  and configured brain mode. Oldest history is dropped first; required input overflow retains both.
- Named choice decoding validates choice, confidence, and each probability independently. Malformed
  output, refusal, provider failure, input overflow, and capacity exhaustion never starve memory.
- Queued plus running work is bounded. Queue time counts toward the deadline; timed-out running
  work keeps its capacity slot until completion. Active waiting is bounded by the remaining budget.
- Retrieval stays concurrent, permission filtering remains unconditional, and classification can
  only discard an authorized list. Uncredentialed members skip the question and stay shared-only.
- Shadow returns both immediately; callbacks use captured session/correlation ids. Late results
  cannot change an emitted answer. Empty selected pools preserve honest-answer behavior.
- Configured scope/reason use existing `controller_reasons` persistence. Confidence, mode, backend,
  request duration and post-retrieve wait use allowlisted logs; no new DB column or API/UI contract.

Completed code-part commits: `7fdba1c` (configuration/client), `aeafed4` (adapter), `76a128b`
(retrieval integration). Evidence/probe changes and the requested documentation remain in the
working tree while the remaining evidence gate is open; no implementation was bundled with the
previous docs-only plan.

## Automated checks

Typecheck, Biome lint, worker Ruff, full gateway/frontend/worker suites, isolation, security, and
failure probes passed. Final `npm test`: gateway **175 passed**, frontend **85 passed**,
worker **325 passed, 1 pre-existing skip**; worker coverage **85.80%** against the 80% gate.
Adapter/integration coverage includes refusal, malformed/duplicate/reordered answers, non-finite
and oversized numbers, 401/429/500 errors, zero retries, UTF-8 caps, saturation, queued deadlines,
concurrent reads, shadow non-waiting, late results, separate sitting contexts, and caller row filtering.

BYO compatibility checks (SSE parsing plus unauthenticated/missing-header refusals) passed.
The live portions of `npm run byo` and `npm run chat` were deliberately run with
`PROBE_PERSONA_ID=`: both report **SKIP** for real persona writes. They do not prove a new live
product turn. The owner will run the actual typed/voice sitting below.

## Real API calibration

Run command:

```bash
uv run --directory worker python -m worker.decisions.probe --threshold 0.7
```

The probe is read-only: synthetic fixture text, no Engram calls, no sitting creation, no private
writes. Without credentials it prints SKIP. It reports only case ids, expected/predicted choices,
confidence, probabilities, durations, and aggregate verdicts; no keys or raw provider response.

[Captured runs](evidence/decisions-scope-2026-10-10.json) record the model, prompt hash, timeout,
retry count, threshold and all case results. Model `gpt-6-luna`, request budget 1.5 seconds.
Fixtures are in `worker/tests/fixtures/decisions/scope.json`; an identical bundled copy allows
running the probe from worker images. Cases cover persona/caller/mixed, ambiguous follow-ups,
corrections, quoted speech and missing context. Labels are proposed reviewable expectations;
Tauqueer has not independently signed off this fixture set.

- Initial run without a confidence threshold: 8 valid answers, 4 timeouts. Two ambiguous/no-context
  cases incorrectly narrowed to shared, at confidence 0.25 and 0.28. Timeout cause was not established.
- Second run with candidate **0.7**: 12/12 valid named answers; 9 effective policy matches, 3 conservative both
  choices, **0 incorrect narrowings**. Duration range 122.27–379.88 ms for this run.
- The threshold is a candidate only. It has **not** been approved or written to `.env` or defaults.
  Twelve synthetic cases are preliminary classification evidence, not a voice latency or broad
  product-quality guarantee. More representative sitting cases can be supplied with `--fixture`.

## Latency evidence still open

`npm run budgets` failed on the existing two retrieve samples: p50 **5,045 ms** versus the configured
**4,000 ms** budget; p90 **6,113.8 ms** versus **8,000 ms** passed. These existing samples are not
paired feature-off/active Decisions turns and establish no regression attributable to this change.
The failing gateway stage prevented that command's later Engram-log stage from running.

Use fresh equivalent questions/personas for feature-off and active sittings, record each
correlation id and first-word timing, and compare only those samples. Read `scope_duration_ms`
and `scope_wait_ms` separately from `brain_ms`. The existing budget aggregate is grouped by brain
mode, so it cannot distinguish routing modes on its own. Do not increase a budget to hide a failure.

## Owner manual sitting

Configuration is loaded at worker startup. Nothing here has edited `.env` or restarted the user's
services. First use a published persona and a member with real private credentials:

```dotenv
ENGRAM_SCOPE_ROUTER_ENABLED=true
ENGRAM_SCOPE_ROUTER_BACKEND=decisions
DECISIONS_SCOPE_MODE=shadow
```

Run/restart the worker with `npm run dev:worker`. Review classification logs while replies retain
both authorized pools. If `.env` defines `LOG_TURN_FIELDS`, append the new metadata names
(`scope_backend,scope_mode,scope_choice,scope_confidence,scope_duration_ms,scope_wait_ms`);
old explicit allowlists override defaults and otherwise omit those fields. Session/correlation ids
are still mandatory. Raw question/history/memory fields are never supplied by classifier logging.

After Tauqueer approves a threshold, set `DECISIONS_SCOPE_MIN_CONFIDENCE` to that value and
`DECISIONS_SCOPE_MODE=active` for the test sitting, then restart the worker. Follow the full
[manual checklist](../plans/openai-decisions.md#part-15--manual-sitting-rollback-and-documentation):

1. In `/chat`, ask known persona and caller facts, a mixed question, a history-dependent follow-up,
   a correction, and an unknown caller fact. Verify attribution and honest empty-memory answers.
2. Repeat in an Aura sitting and a Fish sitting with a real configured voice/key. A missing Fish
   configuration is an outstanding check, not a pass.
3. Use another caller and persona; confirm private facts and sitting history stay isolated.
4. End and reopen a sitting; verify caller-fact extraction/recall and the new sitting identity.
5. Capture paired feature-off/active first-word samples and confirm failure fallback locally.
6. Roll back with `ENGRAM_SCOPE_ROUTER_ENABLED=false` (both authorized pools, no classification),
   or `DECISIONS_SCOPE_MODE=off` with Decisions selected. Explicit legacy rollback is
   `ENGRAM_SCOPE_ROUTER_BACKEND=chat_completions`. Restart and verify the restored behavior.

Record the outcome, approved threshold and paired latency evidence in the plan/progress docs.
Per [AGENTS.md](../../AGENTS.md), do not mark the phase complete before the required sitting passes.
Do not start Phase 2 until Tauqueer names it. Proposed ADR 0006 remains Proposed.


## Later combined-request evidence

Phase 2 code was explicitly authorized before the Phase 1 sitting. Its additional 14-case
combined probe found two scope disagreements at the earlier `0.7` candidate. Re-evaluation with
scope `0.9` and conversation `0.8` had no incorrect narrowings or unanswered requests in that run.
[Combined evidence](decisions-conversation.md). This does not change the recorded scope-only
run or approve a threshold; review both fixture sets before activation.
