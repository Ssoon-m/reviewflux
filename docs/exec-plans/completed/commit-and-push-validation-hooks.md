# Commit And Push Validation Hooks

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux already has meaningful repository checks (`pnpm check`, `pnpm lint`, `pnpm depcruise`), but contributors can still create commits or pushes without running them first. This track adds repo-managed commit and push hooks so local commits fail fast when type-checking, lint, or architecture-boundary validation is broken, and local pushes rerun type-checking before code leaves the machine. After this change, `pnpm install` should install the hooks automatically and `git commit` plus `git push` should run their respective validation chains for every contributor.

## Progress

- [x] (2026-03-18 09:18Z) Confirmed the repo does not already use Husky, Lefthook, or a custom shared hooks path.
- [x] (2026-03-18 09:19Z) Added Husky, `prepare`, `validate:pre-commit`, and `.husky/pre-commit` so the repo installs and runs pre-commit validation locally.
- [x] (2026-03-18 09:20Z) Documented the hook behavior and verified `pnpm validate:pre-commit` plus `pnpm test:all` pass on the current tree.
- [x] (2026-03-18 09:25Z) Added `validate:pre-push` and `.husky/pre-push` so local pushes rerun type-checking before push.

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

The final layout keeps the shell hooks intentionally thin. `package.json` owns the actual validation commands, `.husky/pre-commit` invokes `pnpm validate:pre-commit`, `.husky/pre-push` invokes `pnpm validate:pre-push`, and `docs/CODING_CONVENTION.md` now tells contributors that local commits and pushes are expected to pass the same validation chains.

## Context and Orientation

`package.json` already defines the repo's main validation entrypoints: `build`, `check`, `lint`, `depcruise`, `test`, and `test:all`. This plan targets local commit and push validation, so the hooks should stay focused on checks that are strong enough to block bad commits or obviously broken pushes without turning every hook run into a full CI replay.

The repository now treats `.dependency-cruiser.cjs` as the single source of truth for architecture import rules, and ESLint consumes that same config through `tools/eslint/dependency-cruiser-plugin.mjs`. The hook should therefore run at least `pnpm check`, `pnpm lint`, and `pnpm depcruise`.

## Plan of Work

First, add Husky as a development dependency and wire a `prepare` script so the hook installs on dependency install. Then create a `validate:pre-commit` script in `package.json` that runs `pnpm check && pnpm lint && pnpm depcruise`.

Next, add `.husky/pre-commit` to invoke that shared script and `.husky/pre-push` to invoke a slimmer `validate:pre-push` script that reruns type-checking. Keeping the logic in `package.json` reduces duplication and makes it easier to run the exact same commands manually.

Finally, update developer-facing docs to mention the pre-commit validation behavior and run the validation chain directly to verify the hook target remains green.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm add -D husky`
Expected: `package.json` and `pnpm-lock.yaml` include Husky.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm validate:pre-commit`
Expected: `check`, `lint`, and `depcruise` all pass.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm validate:pre-push`
Expected: `check` passes.

## Validation and Acceptance

Acceptance requires the repo to install the Husky hooks and to keep their targets green on the current tree. The strongest proof is:

- `package.json` contains `prepare` and `validate:pre-commit`
- `.husky/pre-commit` exists and calls the shared validation script
- `pnpm validate:pre-commit` passes
- `package.json` contains `validate:pre-push`
- `.husky/pre-push` exists and calls the shared validation script
- `pnpm validate:pre-push` passes

## Idempotence and Recovery

The work is safe to retry. Re-running `pnpm add -D husky` is idempotent under pnpm, and the shell hook file is additive. If the hook ever becomes too slow or needs a different command set, adjust only `validate:pre-commit` and keep the shell hook thin.

## Artifacts and Notes

- `.husky/pre-commit` runs `pnpm validate:pre-commit`.
- `.husky/pre-push` runs `pnpm validate:pre-push`.
- `package.json` now contains `prepare`, `validate:pre-commit`, and `validate:pre-push`.
- `docs/CODING_CONVENTION.md` now documents the local commit and push expectations.

## Interfaces and Dependencies

- `package.json` should own the hook validation commands.
- `.husky/pre-commit` and `.husky/pre-push` should remain small wrappers that delegate to pnpm.
- `.dependency-cruiser.cjs` remains the source of truth for architecture rules even inside the hook flow.

## Revision Notes

- 2026-03-18 - Created the plan after the user requested pre-commit validation before commit and PR creation.
- 2026-03-18 - Marked the hook work complete after Husky installation, `core.hooksPath` setup, and green validation.
- 2026-03-18 - Expanded the final state to include a `pre-push` type-check hook and renamed the plan to reflect both hooks.
