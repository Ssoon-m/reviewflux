# ESLint Dependency-Cruiser Editor Integration

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux already validates architecture boundaries with `dependency-cruiser`, but those violations only appear when contributors run `pnpm depcruise`. The goal of this track is to surface the same violations through ESLint so editors can show boundary errors inline while keeping `.dependency-cruiser.cjs` as the single source of truth for boundary rules. After this change, a bad import such as `src/gateway -> src/review` should fail in both `pnpm depcruise` and `pnpm lint`, without duplicating rule definitions in `eslint.config.mjs`.

## Progress

- [x] (2026-03-18 05:15Z) Reviewed `docs/PLANS.md`, `eslint.config.mjs`, and `.dependency-cruiser.cjs` to confirm this is multi-step work and to capture the current lint and architecture rule setup.
- [x] (2026-03-18 08:55Z) Installed and evaluated `eslint-plugin-dependency-cruiser` against the repo's flat ESLint config.
- [x] (2026-03-18 09:05Z) Replaced the incompatible third-party plugin with a local ESLint adapter that reads `.dependency-cruiser.cjs` and exposes `dependency-cruiser/errors` plus `dependency-cruiser/warnings` without copying forbidden-edge rules into `eslint.config.mjs`.
- [x] (2026-03-18 09:10Z) Verified `pnpm lint`, `pnpm depcruise`, `pnpm check`, `pnpm build`, `pnpm test`, and `pnpm test:all` pass, then prepared this plan to move to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: The upstream `eslint-plugin-dependency-cruiser` README documents `.eslintrc` usage and expects Dependency Cruiser config to live in `.dependency-cruiser.js` by default, but it also exposes an ESLint `settings["dependency-cruiser"].config` hook for custom config filenames.
  Evidence: https://github.com/pekala/eslint-plugin-dependency-cruiser README lines 250-260 viewed on 2026-03-18.
- Observation: `eslint-plugin-dependency-cruiser@0.1.1` cannot load against `dependency-cruiser@17.3.9` in this repo because it expects a CommonJS package export that no longer exists. Importing the package fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  Evidence: local evaluation of `node -e "import plugin from 'eslint-plugin-dependency-cruiser'"` on 2026-03-18 failed before any ESLint wiring.
- Observation: Running dependency-cruiser for the entire `src` tree once is fast enough for lint integration here, but the JSON output exceeds `spawnSync`'s default buffer and needs an explicit `maxBuffer`.
  Evidence: `pnpm exec depcruise --config .dependency-cruiser.cjs --output-type json src` completed in about 2.1s locally on 2026-03-18, while the first ESLint adapter attempt failed with `spawnSync ... ENOBUFS`.

## Decision Log

- Decision: Keep `.dependency-cruiser.cjs` as the only place where forbidden-edge rules are authored, and treat ESLint as a consumer of that file rather than a second architecture-rule engine.
  Rationale: Duplicating boundary rules in `eslint.config.mjs` would drift quickly and defeat the user's requirement that ESLint only read what `.dependency-cruiser.cjs` defines.
  Date/Author: 2026-03-18 / Codex
- Decision: Do not keep `eslint-plugin-dependency-cruiser` as a runtime dependency. Replace it with a local adapter module under `tools/eslint/` that preserves the same rule shape (`dependency-cruiser/errors` and `dependency-cruiser/warnings`) while calling the installed Dependency Cruiser CLI directly.
  Rationale: The third-party plugin is unmaintained relative to the repo's `dependency-cruiser` version and ESLint flat config. A local adapter keeps the source-of-truth guarantee, avoids vendoring duplicate architecture rules, and is easier to keep compatible with the repo's actual toolchain.
  Date/Author: 2026-03-18 / Codex
- Decision: Scope the ESLint dependency-cruiser rule execution to `src/**/*` in `eslint.config.mjs`.
  Rationale: The current `.dependency-cruiser.cjs` forbidden rules all target `src` boundaries. Restricting the adapter to `src` keeps `pnpm lint` fast enough for editor feedback without introducing a second rule-definition surface.
  Date/Author: 2026-03-18 / Codex

## Outcomes & Retrospective

The repo now surfaces `.dependency-cruiser.cjs` violations through ESLint as well as through `pnpm depcruise`. The final implementation lives in `tools/eslint/dependency-cruiser-plugin.mjs`, which exposes the same `dependency-cruiser/errors` and `dependency-cruiser/warnings` rule names the external plugin would have used, but reads the actual repository Dependency Cruiser config and reports those violations through ESLint.

This track also added a regression test in `tests/eslint-dependency-cruiser-plugin.test.ts` that creates a temporary `src/gateway` file with an illegal import and proves ESLint reports the `no-gateway-to-review-runtime` violation from `.dependency-cruiser.cjs`. No follow-up work is required to ship this change, but if the repo later adds non-`src` dependency rules the ESLint file globs should be revisited.

## Context and Orientation

`dependency-cruiser` is already installed and wired to `pnpm depcruise` through `package.json`. Boundary rules live in `.dependency-cruiser.cjs`, currently covering edges such as `src/gateway/** -> src/review/**` and `src/contracts/** -> higher-level domains`. ESLint is configured through the flat-config file `eslint.config.mjs`, which currently handles language defaults, TypeScript lint rules, and a CommonJS override for `.dependency-cruiser.cjs`, but it does not report architecture violations.

The target repository boundaries were recently clarified in `ARCHITECTURE.md` under the "layered domain architecture with explicit cross-cutting boundaries" framing. This change should preserve that model by making editor feedback consistent with `pnpm depcruise`.

## Plan of Work

The first implementation attempt evaluated the external `eslint-plugin-dependency-cruiser` package directly. That quickly showed a compatibility wall: the plugin is built for older ESLint config style and an older CommonJS-accessible Dependency Cruiser API, while this repo uses ESLint flat config and `dependency-cruiser@17` ESM exports.

The implementation then pivoted to a local adapter. `tools/eslint/dependency-cruiser-plugin.mjs` now invokes the installed Dependency Cruiser CLI, parses its JSON output, caches results per target tree, and maps dependency rule violations back onto ESLint `ImportDeclaration` and re-export nodes. `eslint.config.mjs` enables that adapter only for `src/**/*` files and passes `.dependency-cruiser.cjs` through `settings["dependency-cruiser"].config`, keeping the actual forbidden-edge rules out of the ESLint config.

The last step added a temporary-file integration test and ran the full repository verification chain so the editor-facing diagnostics, CLI dependency validation, build output, and existing test suite all agreed on the final state.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm add -D eslint-plugin-dependency-cruiser`
Observed: the package installed, but local evaluation showed it was incompatible with `dependency-cruiser@17.3.9`, so it was removed after the adapter decision.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm lint`
Observed: passes after the local adapter and `src/**/*` scope restriction were in place. Local timing was about 3.5s.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm depcruise && pnpm check && pnpm build && pnpm test`
Observed: all commands pass with the current tree.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test:all`
Observed: passes end-to-end, including the new ESLint dependency-cruiser regression test.

## Validation and Acceptance

Acceptance requires both static validation paths to agree. A valid tree must pass `pnpm lint` and `pnpm depcruise`. The strongest proof is either a real or synthetic forbidden import that causes ESLint to report the same architectural violation already defined in `.dependency-cruiser.cjs`, while the clean tree remains green.

## Idempotence and Recovery

This track is safe to retry because it is additive. Re-running `pnpm add -D eslint-plugin-dependency-cruiser` is idempotent under pnpm. If flat-config integration fails, the fallback is to remove only the plugin wiring from `eslint.config.mjs` and keep the existing `dependency-cruiser` CLI validation untouched.

## Artifacts and Notes

- `tools/eslint/dependency-cruiser-plugin.mjs` is the shipped local adapter.
- `tests/eslint-dependency-cruiser-plugin.test.ts` proves ESLint surfaces `.dependency-cruiser.cjs` violations for an illegal `src/gateway -> src/review` edge.
- `docs/CODING_CONVENTION.md` now notes that architecture import boundaries are surfaced by both `pnpm depcruise` and `pnpm lint` from the same config file.

## Interfaces and Dependencies

- `eslint.config.mjs` must remain the only ESLint config file.
- `.dependency-cruiser.cjs` must remain the only authored architecture-rule file.
- `package.json` scripts `lint` and `depcruise` must continue to work.
- `tools/eslint/dependency-cruiser-plugin.mjs` must continue to read `.dependency-cruiser.cjs` rather than owning a second copy of forbidden-edge rules.

## Revision Notes

- 2026-03-18 - Created the plan after confirming the repo currently exposes boundary violations only through `pnpm depcruise`.
- 2026-03-18 - Recorded the external plugin compatibility failure, the local adapter replacement, the `src/**/*` scope choice, and the final verification results.
