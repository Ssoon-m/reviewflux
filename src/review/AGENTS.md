# REVIEW DOMAIN MAP

## SCOPE
This file applies to `src/review/`. For changes under `src/review/queue/`, also read `src/review/queue/AGENTS.md`.

## HIGH-SIGNAL FILES
- `src/review/runtime.ts` - end-to-end review orchestration, dedupe, and review posting entrypoint.
- `src/review/github.ts` - GitHub transport and remote project-context loading.
- `src/review/state-store.ts` - persisted review state and handled-trigger tracking.
- `src/review/manual-trigger.ts` - manual review trigger parsing and reply behavior.
- `src/review/finding-fingerprint.ts` - duplicate-finding detection.

## CROSS-BOUNDARY DEPENDENCIES
- `src/llm/project-context.ts`, `src/llm/review-prompt.ts` - context resolution and prompt assembly owned outside `src/review/`; use root guidance there.
- `src/gateway/review-posting.ts`, `src/gateway/review-publisher.ts` - review posting boundary owned outside this subtree.

## LOCAL INVARIANTS
- Keep orchestration in `runtime.ts`, transport in `github.ts`, and posting in `src/gateway/`. Do not collapse those roles together.
- Manual-trigger handling, posted-review dedupe, and finding fingerprinting are correctness rules. Avoid loosening them casually.
- Preserve current context-loading semantics unless the task explicitly changes policy input. Local default is `AGENTS.md`; remote review loading currently expands to include `**/AGENTS.md`.
- When touching review policy flow, keep the relationship clear between the setup-seeded global guidance file, the runtime base template, and repo-specific project context.
- Log unknown errors with safe stringification and preserve secret redaction.

## TESTS TO CHECK
- `tests/review-runtime.test.ts`
- `tests/project-context.test.ts`
- `tests/review-output.test.ts`
- `tests/review-posting.test.ts`
- `tests/review-publisher.test.ts`
- `tests/daemon-review-output.test.ts`
- `tests/finding-fingerprint.test.ts`

## CHANGE CHECKLIST
- Verify the closest runtime test for the exact trigger or posting path you changed.
- If context discovery or prompt inputs changed, inspect both `src/llm/project-context.ts` and the user-facing repo command flow that stores context patterns, using root guidance outside `src/review/`.
- If queue behavior is involved, also read `src/review/queue/AGENTS.md`.
