# Pre-Commit Validation Hook

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux already has meaningful repository checks (`pnpm check`, `pnpm lint`, `pnpm depcruise`), but contributors can still create commits without running them first. This track adds a repo-managed pre-commit hook so local commits fail fast when type-checking, lint, or architecture-boundary validation is broken. After this change, `pnpm install` should install the hook automatically and `git commit` should run the same pre-commit validation chain for every contributor.

## Progress

- [x] (2026-03-18 09:18Z) Confirmed the repo does not already use Husky, Lefthook, or a custom shared hooks path.
- [x] (2026-03-18 09:19Z) Added Husky, `prepare`, `validate:pre-commit`, and `.husky/pre-commit` so the repo installs and runs pre-commit validation locally.
- [x] (2026-03-18 09:20Z) Documented the hook behavior and verified `pnpm validate:pre-commit` plus `pnpm test:all` pass on the current tree.

## Surprises & Discoveries

- Observation: The repository currently has no hook manager and no `prepare` script in `package.json`, so hook installation needs to be introduced rather than extended.
  Evidence: `rg -n "husky|lefthook|pre-commit|hooksPath|prepare" -S .` returned no existing hook setup on 2026-03-18.
- Observation: Running `pnpm run prepare` configures Git with `core.hooksPath=.husky/_`, while the user-authored hook still lives at `.husky/pre-commit`.
  Evidence: `git config --get core.hooksPath` returned `.husky/_` after Husky installation on 2026-03-18.

## Decision Log

- Decision: Use Husky with a `prepare` script and a dedicated `validate:pre-commit` npm script.
  Rationale: This keeps hook installation reproducible for contributors without relying on local `git config core.hooksPath` state, and it centralizes the actual validation command in `package.json` instead of hardcoding a long chain only inside the shell hook.
  Date/Author: 2026-03-18 / Codex

## Outcomes & Retrospective

ReviewFlux now installs a Husky pre-commit hook via `prepare` and delegates the actual validation chain to `pnpm validate:pre-commit`. The hook blocks commits when `pnpm check`, `pnpm lint`, or `pnpm depcruise` fail, which is the right pre-commit scope for this repo because it includes type errors, style and import-boundary violations, and architecture drift without forcing the full test suite on every single commit.

The final layout keeps the shell hook intentionally thin. `package.json` owns the actual validation command, `.husky/pre-commit` only invokes that command, and `docs/CODING_CONVENTION.md` now tells contributors that local commits are expected to pass the same validation chain.

## Context and Orientation

`package.json` already defines the repo's main validation entrypoints: `build`, `check`, `lint`, `depcruise`, `test`, and `test:all`. This plan only targets pre-commit validation, so the hook should stay focused on checks that are strong enough to block bad commits but still fast enough to run before every commit.

The repository now treats `.dependency-cruiser.cjs` as the single source of truth for architecture import rules, and ESLint consumes that same config through `tools/eslint/dependency-cruiser-plugin.mjs`. The hook should therefore run at least `pnpm check`, `pnpm lint`, and `pnpm depcruise`.

## Plan of Work

First, add Husky as a development dependency and wire a `prepare` script so the hook installs on dependency install. Then create a `validate:pre-commit` script in `package.json` that runs `pnpm check && pnpm lint && pnpm depcruise`.

Next, add `.husky/pre-commit` to invoke that shared script. Keeping the logic in `package.json` reduces duplication and makes it easier to run the exact same command manually.

Finally, update developer-facing docs to mention the pre-commit validation behavior and run the validation chain directly to verify the hook target remains green.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm add -D husky`
Expected: `package.json` and `pnpm-lock.yaml` include Husky.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm validate:pre-commit`
Expected: `check`, `lint`, and `depcruise` all pass.

## Validation and Acceptance

Acceptance requires the repo to install a pre-commit hook via Husky and to keep the hook target green on the current tree. The strongest proof is:

- `package.json` contains `prepare` and `validate:pre-commit`
- `.husky/pre-commit` exists and calls the shared validation script
- `pnpm validate:pre-commit` passes

## Idempotence and Recovery

The work is safe to retry. Re-running `pnpm add -D husky` is idempotent under pnpm, and the shell hook file is additive. If the hook ever becomes too slow or needs a different command set, adjust only `validate:pre-commit` and keep the shell hook thin.

## Artifacts and Notes

- `.husky/pre-commit` runs `pnpm validate:pre-commit`.
- `package.json` now contains both `prepare` and `validate:pre-commit`.
- `docs/CODING_CONVENTION.md` now documents the pre-commit expectation.

## Interfaces and Dependencies

- `package.json` should own the hook validation command.
- `.husky/pre-commit` should remain a small wrapper that delegates to pnpm.
- `.dependency-cruiser.cjs` remains the source of truth for architecture rules even inside the hook flow.

## Revision Notes

- 2026-03-18 - Created the plan after the user requested pre-commit validation before commit and PR creation.
- 2026-03-18 - Marked the hook work complete after Husky installation, `core.hooksPath` setup, and green validation.
