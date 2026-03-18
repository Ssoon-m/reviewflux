# PR 18 Review Follow-Ups

This track reconciled the review feedback attached to GitHub PR `#18` with the code already on branch `work/layered-boundaries-lint-imports`. The goal was to apply the valid follow-ups, reject already-fixed or incorrect findings with evidence, and leave the branch in a verifiable state.

The review sources were the PR review summary and inline comments on `https://github.com/Ssoon-m/reviewflux/pull/18`. The branch already contained the live-source ESLint dependency-cruiser fix (`fix: lint dependency boundaries from live source`), so the remaining actionable work narrowed to making the dependency-cruiser boundary direction explicit through regression tests and documenting why the Husky portability suggestion was not adopted.

## Scope and Boundaries

This work touched:

- `.dependency-cruiser.cjs` for clearer rule wording only, not boundary behavior changes.
- `tests/eslint-dependency-cruiser-plugin.test.ts` for regression coverage.
- Plan indexes under `docs/exec-plans/`.

It intentionally did not change review runtime, queue processing, or PR polling behavior.

## Review Triage

- Live-source ESLint dependency-cruiser feedback from `chatgpt-codex-connector[bot]` was already fixed on this branch before this track started. Verification confirmed the fix remained present, so no extra code change was needed there.
- Husky portability feedback on `.husky/pre-commit` and `.husky/pre-push` was evaluated but intentionally not adopted. The repository keeps the hook files as minimal `pnpm ...` wrappers and relies on Husky's existing bootstrap plus the documented Node/pnpm toolchain expectations.
- The `.dependency-cruiser.cjs` feedback about cross-cutting boundaries was rejected as a behavior change because it misread Dependency Cruiser `from -> to` direction. Instead of weakening the rule, this track clarified the rule wording and added tests that prove legal `src/review -> src/contracts` imports remain allowed while illegal `src/contracts -> src/review` imports still fail.

## Progress

- [x] (2026-03-18) Collected PR `#18` review summaries, inline comments, and conversation comments from GitHub.
- [x] (2026-03-18) Verified that the live-source ESLint dependency-cruiser review had already been addressed in `tools/eslint/dependency-cruiser-plugin.mjs`.
- [x] (2026-03-18) Confirmed the Husky portability suggestion would not ship and restored the hooks to their original thin `pnpm` wrappers.
- [x] (2026-03-18) Added regression coverage for dependency-cruiser boundary direction semantics.
- [x] (2026-03-18) Ran targeted and full verification, then moved this plan to `completed/`.

## Decisions

- Keep `.dependency-cruiser.cjs` as the only authored boundary rule file. If a review questions boundary direction, prove the semantics with tests instead of duplicating or weakening the rule set.
- Keep `.husky/*` as thin `pnpm` wrappers. Do not add shell fallback logic unless the repo explicitly chooses to broaden its local toolchain contract.
- Clarify the `no-cross-cutting-to-domains` rule comment to describe the exact importer/importee direction explicitly, since the review confusion showed the old wording was easy to misread.

## Validation

Targeted:

- `pnpm test -- --run tests/eslint-dependency-cruiser-plugin.test.ts`
  Observed: passes, though the repo's `test` wrapper still expands to the full Vitest suite. Final result: `35` test files, `184` tests passed.

Full:

- `pnpm depcruise`
  Observed: `no dependency violations found (1376 modules, 4861 dependencies cruised)`.
- `pnpm validate:pre-commit`
  Observed: passes.
- `pnpm validate:pre-push`
  Observed: passes.
- `pnpm test:all`
  Observed: passes, including `build`, `check`, `lint`, `depcruise`, and the full Vitest suite (`36` files, `186` tests).

Behavioral:

- Dependency-cruiser lint integration still reports an illegal `src/gateway -> src/review` edge, allows legal `src/review -> src/contracts` imports, and reports the illegal reverse `src/contracts -> src/review` edge.
