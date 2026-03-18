# Live ESLint Boundary Feedback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux already surfaces `.dependency-cruiser.cjs` boundary rules through ESLint, but the current adapter shells out to Dependency Cruiser against the saved tree. That means editor diagnostics can lag behind the current unsaved buffer. The goal of this track is to make the ESLint rule use the current source being linted so new forbidden imports appear immediately and removed imports disappear immediately, while still reading the rule definitions only from `.dependency-cruiser.cjs`.

## Progress

- [x] (2026-03-18 09:49Z) Verified the review finding against `tools/eslint/dependency-cruiser-plugin.mjs` and confirmed the current implementation only inspects saved files through `getPhysicalFilename(context)` plus a Dependency Cruiser CLI run.
- [x] (2026-03-18 09:59Z) Replaced the saved-tree dependency lookup with a live rule evaluator that uses the current ESLint AST/source and the repository `.dependency-cruiser.cjs` config.
- [x] (2026-03-18 10:00Z) Added `lintText(..., { filePath })` regression coverage and reran repository validation.

## Surprises & Discoveries

- Observation: The current plugin does not read `context.getSourceCode()` or the current AST import list at all; it only reads the linted file path and then shells out to Dependency Cruiser.
  Evidence: `tools/eslint/dependency-cruiser-plugin.mjs` lines 296-323 on 2026-03-18.

## Decision Log

- Decision: Keep `.dependency-cruiser.cjs` as the only source of rule definitions, but stop invoking the Dependency Cruiser CLI for live ESLint diagnostics. Instead, evaluate the current file's imports directly against the loaded rule set.
  Rationale: This fixes the editor-lag bug without introducing a second authored boundary config or relying on temp-file overlays of the whole repository.
  Date/Author: 2026-03-18 / Codex

## Outcomes & Retrospective

The ESLint dependency-cruiser adapter now validates the current linted file's imports directly instead of shelling out to Dependency Cruiser against the saved tree. This fixes the editor-lag problem called out in review: new forbidden imports in an unsaved buffer now show up immediately, and removed imports disappear immediately.

The implementation still keeps `.dependency-cruiser.cjs` as the sole authored boundary definition. The adapter now loads and normalizes that config, resolves the current file's import specifiers with TypeScript, and runs Dependency Cruiser's own `validateDependency` matcher logic against the live AST imports. The regression test now uses `ESLint#lintText(..., { filePath })` to prove the rule works on in-memory source.

## Context and Orientation

The existing adapter lives in `tools/eslint/dependency-cruiser-plugin.mjs` and is wired into `eslint.config.mjs`. Boundary definitions live in `.dependency-cruiser.cjs`, and the repo uses `typescript` plus bundler-style resolution for extensionless local imports. The new implementation needs to respect the current linted source, so tests should use `ESLint#lintText(..., { filePath })` rather than only `lintFiles(...)`.

## Plan of Work

First, replace the CLI-based dependency index with a per-file live validator. The adapter should load and cache the Dependency Cruiser config, normalize it once, resolve current import specifiers from the active file path, and validate each current import against the forbidden rules. This removes the dependency on saved-file mtimes for current-file diagnostics.

Next, update the integration test to use `lintText` with a virtual `src/gateway/...` path so the test proves ESLint reports a violation from the in-memory source even when no file needs to exist on disk.

Finally, run targeted tests and `pnpm test:all` to ensure the refactor does not break the broader lint, type-check, dependency validation, or test flow.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test -- --run tests/eslint-dependency-cruiser-plugin.test.ts`
Expected: the new `lintText`-based regression test passes.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test:all`
Expected: build, check, lint, depcruise, and the full test suite all pass after the adapter change.

## Validation and Acceptance

Acceptance requires:

- the ESLint dependency-cruiser adapter to read current imports from the active linted file rather than from only the saved tree
- `.dependency-cruiser.cjs` to remain the only authored boundary config
- `tests/eslint-dependency-cruiser-plugin.test.ts` to prove live `lintText` diagnostics work
- `pnpm test:all` to stay green

## Idempotence and Recovery

This work is safe to retry. The adapter is internal to the repo, and the test case is additive. If the live validation path proves too brittle, the fallback is to keep the config-loading improvements and explicitly downgrade the editor guarantee, but that is not the target outcome.

## Artifacts and Notes

- `tools/eslint/dependency-cruiser-plugin.mjs` now uses live AST import resolution and Dependency Cruiser validation instead of a CLI cruise of the saved tree.
- `tests/eslint-dependency-cruiser-plugin.test.ts` now uses `lintText(..., { filePath })` to assert live editor-style diagnostics.

## Interfaces and Dependencies

- `tools/eslint/dependency-cruiser-plugin.mjs` remains the shipped ESLint adapter
- `.dependency-cruiser.cjs` remains the source of truth for boundary rules
- `tests/eslint-dependency-cruiser-plugin.test.ts` should cover the live-current-source path

## Revision Notes

- 2026-03-18 - Created this plan after accepting the review that the adapter currently reports against the saved tree instead of the current linted source.
- 2026-03-18 - Marked the work complete after live AST validation replaced the saved-tree cruise path and `pnpm test:all` passed.
