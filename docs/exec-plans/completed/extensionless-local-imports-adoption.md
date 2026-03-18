# Adopt Extensionless Local Imports Across The Repo

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux currently uses explicit `.js` suffixes in local imports because the repo is configured for `NodeNext`. The requested change is to make local imports extensionless throughout the repository, such as changing `../auth/pi-oauth.js` to `../auth/pi-oauth`.

This is not just a search-and-replace. It changes the TypeScript module-resolution model that powers `pnpm check`, ESLint, dependency-cruiser, tests, and the build pipeline. After this work, local imports in `src`, `tests`, and relevant repo files should be extensionless, and the full verification chain should still pass.

## Progress

- [x] (2026-03-17 23:50Z) Confirmed that the repo currently enforces `.js` suffixes in `docs/CODING_CONVENTION.md`, uses `module: "NodeNext"` / `moduleResolution: "NodeNext"` in `tsconfig.json`, and contains many `.js` local import specifiers across `src` and `tests`.
- [x] (2026-03-17 23:52Z) Switched TypeScript source checking to `module: "ESNext"` plus `moduleResolution: "Bundler"` and updated the coding convention doc to describe extensionless local imports.
- [x] (2026-03-17 23:53Z) Rewrote local import specifiers across `src`, `tests`, and `scripts` from `.js` to extensionless paths.
- [x] (2026-03-17 23:54Z) Verified that ESLint, dependency-cruiser, and the existing build/test tooling all continued to work without rule rollback.
- [x] (2026-03-17 23:53Z) Ran the full verification chain and recorded passing results.

## Surprises & Discoveries

- Observation: the current coding convention explicitly requires `.js` suffixes for local imports because of `NodeNext`.
  Evidence: `docs/CODING_CONVENTION.md` import rules.
- Observation: the current `tsconfig.json` uses `module: "NodeNext"` and `moduleResolution: "NodeNext"`, which is exactly the combination that makes extensionless ESM-relative imports invalid.
  Evidence: `tsconfig.json`.
- Observation: the repo now has lint and dependency-boundary tooling that also need to keep working after the module-resolution change.
  Evidence: `package.json` includes `lint`, `depcruise`, and `test:all`.
- Observation: the toolchain accepted the change with less fallout than expected. `pnpm check`, `pnpm lint`, and `pnpm depcruise` all passed on the first run after the rewrite.
  Evidence: post-change verification commands completed successfully before any follow-up config changes were needed.
- Observation: dependency-cruiser’s scope expanded noticeably under the new resolver setup, but boundary validation still passed.
  Evidence: `pnpm depcruise` reported `1376 modules, 4861 dependencies cruised`.

## Decision Log

- Decision: move to a bundler-oriented TypeScript module-resolution strategy for source checking, rather than trying to coerce `NodeNext` into allowing extensionless ESM imports.
  Rationale: `NodeNext` intentionally models Node ESM runtime restrictions, while the repo already builds through `tsdown`, which can rewrite module specifiers for runtime output.
  Date/Author: 2026-03-17 / Codex
- Decision: rewrite all local repo imports consistently instead of allowing mixed `.js` and extensionless styles.
  Rationale: a mixed source style would create needless churn and make the coding convention ambiguous. The user explicitly asked for the whole repo to be changed.
  Date/Author: 2026-03-17 / Codex

## Outcomes & Retrospective

The repo now uses extensionless local imports in source and tests. `tsconfig.json` now checks source with bundler-style module resolution, and `docs/CODING_CONVENTION.md` documents extensionless local imports as the expected style.

No extra compatibility shim was required. `tsdown` continued to emit runnable `dist/` output, and the full repo verification chain stayed green. The tradeoff is explicit: source checking is no longer trying to mirror raw Node ESM resolution exactly. Instead, the repo now treats source imports as build-tool-resolved and relies on the bundling step to produce runtime-safe output.

No follow-up blocker was discovered. If someone later wants unbundled direct-Node execution of `src/` files, this decision would need to be revisited.

## Context and Orientation

Relevant files:

- `tsconfig.json` controls `pnpm check`.
- `tsdown.config.ts` controls emitted runtime bundles in `dist/`.
- `eslint.config.mjs` and `.dependency-cruiser.cjs` both rely on the repository’s module resolution behavior.
- `docs/CODING_CONVENTION.md` currently documents the `.js`-suffix rule that must be changed if the source style changes.
- `src/**`, `tests/**`, and selected repo-root config/test harness files contain local `.js` import specifiers that need rewriting.

This plan changes source-style imports, not published package import paths from external consumers.

## Plan of Work

First, change the TypeScript compiler settings so `pnpm check` accepts extensionless local imports. Update the coding convention doc to describe the new rule clearly and keep the reason consistent with the toolchain.

Second, rewrite local `.js` import specifiers across `src`, `tests`, and other checked-in code files to extensionless paths. Keep package imports and non-TypeScript runtime imports unchanged.

Third, run the new verification chain (`build`, `check`, `lint`, `depcruise`, `test`). If any tool fails because it still assumes `NodeNext`, update that tool’s config rather than papering over the import change.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `rg -n "from \".*\\.js\"|from '.*\\.js'|import\\(\".*\\.js\"\\)|import\\('.*\\.js'\\)" src tests scripts`
Expected: shows the local import sites that must be rewritten.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm check`
Expected: passes after the tsconfig and import updates.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test:all`
Expected: build, type-check, lint, dependency validation, and tests all pass with extensionless imports.

## Validation and Acceptance

The change is successful if:

- local imports in `src` and `tests` no longer carry `.js` suffixes by default,
- `docs/CODING_CONVENTION.md` matches the new import style,
- `pnpm build`, `pnpm check`, `pnpm lint`, `pnpm depcruise`, and `pnpm test` all pass,
- the final response explains the module-resolution tradeoff clearly.

## Idempotence and Recovery

The import rewrite is safe to repeat if done mechanically and reviewed afterward. If the toolchain breaks:

1. restore the failing tool’s assumptions by adjusting its config, not by reintroducing mixed import styles casually,
2. re-run the smallest failing command first,
3. only then re-run the full verification chain.

## Artifacts and Notes

- This work happens on branch `work/eslint-depcruise-boundaries`.
- Existing uncommitted tooling adoption changes must be preserved while doing this work.
- Verification evidence:
  - `pnpm check` passed.
  - `pnpm lint` passed.
  - `pnpm depcruise` passed with `1376 modules, 4861 dependencies cruised`.
  - `pnpm build` passed.
  - `pnpm test` passed with `34` files and `181` tests.
  - `pnpm test:all` passed end-to-end.

## Interfaces and Dependencies

- `tsconfig.json`
- `tsdown.config.ts`
- `eslint.config.mjs`
- `.dependency-cruiser.cjs`
- `docs/CODING_CONVENTION.md`
- all local-import call sites in `src` and `tests`

## Revision Notes

- 2026-03-17 - Initial plan created for extensionless local import adoption.
- 2026-03-17 - Updated after the module-resolution switch, repo-wide import rewrite, and passing full verification chain.
