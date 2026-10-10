# Decisions

Architecture and product choices, one file each. Format: [TEMPLATE.md](TEMPLATE.md). Process: [../README.md](../README.md).

Read this index before re-opening a choice. **Accepted** means Tauqueer locked it. Do not rewrite an Accepted body; supersede it with a new numbered file.

Current architecture (mutable “how”): [architecture.md](../architecture.md). Current snapshot: [progress.md](../progress.md).

| ID | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-docs-as-code.md) | Docs live in the repo: map, context, ADRs, no empty Diátaxis folders | Accepted | 2026-09-08 |
| [0002](0002-hosted-fish-tts-per-persona.md) | Hosted Fish TTS per persona; Aura otherwise; no GPU; no id sniffing | Accepted | 2026-09-08 |
| [0003](0003-working-loop.md) | One named part; subparts; tests and logic; ask about manual; then commit and stop | Accepted | 2026-09-08 |
| [0004](0004-early-product-locks.md) | First-build locks that still hold (point to TRD / SHIPPED) | Accepted | 2026-09-08 |
| [0005](0005-persona-voice-provider.md) | Owner chooses Aura or Fish via an env-named provider key; do not infer from a Fish id | Accepted | 2026-09-08 |
| [0006](0006-memory-scope-is-a-model-decision.md) | Which memory pool the answerer sees is a model output, concurrent with retrieve, fail-open | Proposed | 2026-09-09 |
| [0007](0007-production-same-origin.md) | First production sit: one public origin, nginx edge, linear az script | Accepted | 2026-09-09 |
| [0008](0008-deploy-in-cognora-alpha-rg.md) | Bot resources go in cognora-alpha-rg; do not touch Cognora servers | Accepted | 2026-09-09 |
| [0009](0009-private-is-extracted-caller-facts.md) | Private pool is extracted caller facts, not the sitting transcript | Accepted | 2026-09-17 |
| [0010](0010-chat-ends-with-hangup.md) | Typed chat ends with hang-up, like a voice call | Accepted | 2026-09-17 |
| [0011](0011-audio-mode-is-measured-not-assumed.md) | Echo cancellation vs loudspeaker is measured on a device, then locked | Proposed | 2026-09-18 |
| [0012](0012-voice-settings-are-per-persona.md) | Voice settings that differ between personas live on the persona, with a preview | Proposed | 2026-09-18 |
| [0013](0013-spoken-output-stays-simple.md) | Spoken output stays the simple Fish path sat on 1 Oct 2026; short answers are a prompt | Accepted | 2026-10-01 |
