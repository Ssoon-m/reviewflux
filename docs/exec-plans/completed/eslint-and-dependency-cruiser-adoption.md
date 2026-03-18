# Adopt ESLint And Dependency-Cruiser For Enforced Boundaries

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux now documents its architecture as layered domain architecture with explicit cross-cutting boundaries, but the repository still relies on humans to remember those rules. This work adds two enforcement mechanisms:

- `ESLint` for code-level rules and consistent linting across `src`, `tests`, and selected root config files.
- `dependency-cruiser` for explicit import-boundary validation against the architecture rules in `ARCHITECTURE.md`.

After this change, the repo should have one repeatable verification path that catches both local lint issues and architecture-boundary violations before review. The outcome is observable through new config files, package scripts, and successful runs of build, type-check, lint, dependency validation, and tests.

## Progress

- [x] (2026-03-17 23:37Z) Created branch `work/eslint-depcruise-boundaries` and inspected current toolchain state (`package.json`, `tsconfig.json`, existing config files).
- [x] (2026-03-17 23:43Z) Added `eslint.config.mjs`, installed the ESLint stack, and wired `lint` / `lint:fix` scripts into `package.json`.
- [x] (2026-03-17 23:43Z) Added `.dependency-cruiser.cjs`, installed dependency-cruiser, and wired the `depcruise` script into `package.json`.
- [x] (2026-03-17 23:46Z) Fixed lint violations and small compatibility issues surfaced by the new tooling, including explicit `import type` cleanup, safer error rethrow causes, and one helper/type cleanup.
- [x] (2026-03-17 23:47Z) Ran the integrated verification chain through `pnpm test:all`, which now covers build, type-check, lint, dependency validation, and tests.

## Surprises & Discoveries

- Observation: The repo currently has no ESLint or dependency-cruiser config files.
  Evidence: `find . -maxdepth 2` found no `eslint.config.*`, `.eslintrc*`, or `.dependency-cruiser*` files.
- Observation: `tsconfig.json` currently includes only `src`, so ESLint should not depend on typed linting for tests in this first pass.
  Evidence: `tsconfig.json` has `"include": ["src"]`.
- Observation: The initial dependency-cruiser rule set matched current architecture reality immediately; no import-boundary violations were present.
  Evidence: first `pnpm depcruise` run returned `no dependency violations found (83 modules, 207 dependencies cruised)`.
- Observation: The biggest ESLint fallout was not structural; it was a small set of type-import preferences, one generic `any`, one unused destructured field, and new `preserve-caught-error` findings.
  Evidence: first `pnpm lint` run reported `24` errors, then `19` after autofix, all resolved without broad rule rollback.

## Decision Log

- Decision: Use ESLint flat config instead of legacy `.eslintrc`.
  Rationale: ESLint flat config is the current default and matches the official `typescript-eslint` quickstart. It also makes targeted per-file-group configuration easier for this repo.
  Date/Author: 2026-03-17 / Codex
- Decision: Start with non-type-aware TypeScript linting for this pass.
  Rationale: The repo’s `tsconfig.json` does not currently include tests or root config files. Non-typed linting keeps adoption smaller and avoids inflating the initial setup with multiple tsconfig variants before the repo proves the rules are useful.
  Date/Author: 2026-03-17 / Codex
- Decision: Use dependency-cruiser as the architecture-boundary source of truth rather than encoding all boundary rules in ESLint.
  Rationale: dependency-cruiser is purpose-built for dependency validation and keeps boundary rules readable as `from -> to` constraints. ESLint will remain focused on local code quality rules.
  Date/Author: 2026-03-17 / Codex

## Outcomes & Retrospective

The repo now has both enforcement layers:

- `eslint.config.mjs` provides a flat ESLint setup for repo code, tests, and key config files.
- `.dependency-cruiser.cjs` machine-checks the documented architecture boundaries.
- `package.json` now exposes `lint`, `lint:fix`, and `depcruise`, and `test:all` now runs the full verification chain.

The resulting code cleanup stayed small. Most changes were explicit `import type` normalization from autofix plus a handful of pragmatic fixes in helper code and error rethrows. No documented architecture rule had to be weakened to make the repo pass.

If a stricter follow-up is desired later, the most likely next step is typed ESLint for tests/configs via a dedicated lint tsconfig, not more boundary rules.

## Context and Orientation

Current relevant files and boundaries:

- `package.json` currently exposes `build`, `check`, `test`, and `test:all`, but has no lint or dependency-validation scripts.
- `tsconfig.json` is `strict`, uses `NodeNext`, and includes only `src`.
- `ARCHITECTURE.md` now documents `src/contracts`, `src/config`, `src/infra/logging`, `src/lib`, and `src/types` as explicit cross-cutting boundaries and documents forbidden import directions between major boundaries.
- `src/review`, `src/review/queue`, `src/gateway`, `src/auth`, `src/llm`, `src/commands`, and `src/cli` are the main domain and shell boundaries that dependency-cruiser should police.

Important repo conventions from `docs/CODING_CONVENTION.md` that linting should respect:

- ESM imports with explicit `.js` suffixes for local files.
- `node:` prefixes for builtins.
- Named exports preferred.
- No type-safety shortcuts or decorative comments.

## Plan of Work

First, install the minimal official ESLint stack recommended for TypeScript flat config plus the extra runtime globals package that ESLint’s own docs recommend for flat config language options. Create an `eslint.config.mjs` that covers `src/**/*.ts`, `tests/**/*.ts`, and key root config files. The config should enforce a small rule set that aligns with existing code conventions instead of trying to rewrite the whole codebase at once.

Second, install and configure dependency-cruiser. The rules should encode boundary restrictions that are already stated in `ARCHITECTURE.md`, especially:

- `src/gateway` must not import `src/review` or `src/review/queue`.
- `src/contracts`, `src/config`, `src/infra/logging`, `src/lib`, and `src/types` must not import higher-level domain behavior.
- `src/auth` and `src/llm` should not depend on command or runtime layers.
- `src/review/queue` should not depend on shell or publishing boundaries.

Third, run the new tools and fix any violations. Prefer additive fixes or targeted rule tuning over weakening the architecture rules casually. Once lint and boundary checks pass, run the existing build, type-check, and full test suite so the new tooling does not destabilize the repo.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm add -D eslint @eslint/js typescript-eslint dependency-cruiser globals`
Expected: dev dependencies are added to `package.json` and `pnpm-lock.yaml`.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm lint`
Expected: ESLint runs against the configured source set and reports either success or actionable violations.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm depcruise`
Expected: dependency-cruiser validates the `src` graph against the configured architecture rules.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm build && pnpm check && pnpm lint && pnpm depcruise && pnpm test`
Expected: the repo passes the full verification chain on this branch.

## Validation and Acceptance

The change is successful if all of the following are true:

- `package.json` has scripts for linting and dependency-boundary validation.
- The repo contains an ESLint flat config file and a dependency-cruiser config file.
- The dependency-cruiser rules clearly map back to the documented architecture boundaries.
- `pnpm build`, `pnpm check`, `pnpm lint`, `pnpm depcruise`, and `pnpm test` all pass on the branch.
- The final response explains the impact area, the adopted rules, and any remaining known limitations.

## Idempotence and Recovery

All steps are safe to re-run. The package installation is additive. The config files are deterministic. If a verification command fails, the recovery path is:

1. Run the failing tool directly (`pnpm lint` or `pnpm depcruise`).
2. Fix the code or relax only the specific rule that conflicts with documented architecture reality.
3. Re-run the full verification chain.

Do not weaken architecture rules to hide real dependency drift unless the documented architecture is wrong and updated in the same change.

## Artifacts and Notes

- Branch for this work: `work/eslint-depcruise-boundaries`
- Expected new files:
  - `eslint.config.mjs`
  - `.dependency-cruiser.cjs` or equivalent
- Expected package script additions:
  - `lint`
  - `depcruise`
  - possibly an updated aggregate verification script
- Actual verification result:
  - `pnpm test:all` passed after being expanded to `pnpm build && pnpm check && pnpm lint && pnpm depcruise && pnpm test`.
  - Final run result: `34` passing test files, `181` passing tests.

## Interfaces and Dependencies

Expected external packages:

- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `dependency-cruiser`
- `globals`

Expected architectural interfaces:

- `ARCHITECTURE.md` remains the human-readable source of truth.
- dependency-cruiser rules become the machine-checked version of the import-boundary subset of that document.
- ESLint enforces repo-local code quality and consistency conventions.

## Revision Notes

- 2026-03-17 - Initial plan created for ESLint and dependency-cruiser adoption on `work/eslint-depcruise-boundaries`.
- 2026-03-17 - Updated progress and outcomes after tool installation, config authoring, lint cleanup, and full verification success.
