# RVW Command Alias Rollout

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

The README already teaches ReviewFlux through the short `rvw` command, but the published CLI binary, Commander help output, and several operator-facing hints still say `reviewflux`. This track makes `rvw` the preferred invocation end-to-end while keeping `reviewflux` available as a backward-compatible alias. After this change, installing the package should expose both commands, help text should show `rvw`, and user-facing "next step" hints should consistently point to `rvw ...`.

## Progress

- [x] (2026-03-18 09:33Z) Audited the current references to `reviewflux` and `rvw` across the package manifest, CLI help, README, user-facing command hints, and tests.
- [x] (2026-03-18 09:39Z) Updated package bin entries, CLI naming, user-facing command hints, and docs so `rvw` is the preferred invocation while `reviewflux` remains supported.
- [x] (2026-03-18 09:41Z) Refreshed tests and ran validation so the renamed command surface stays green.

## Surprises & Discoveries

- Observation: README is already written around `rvw`, so the current inconsistency is mainly between documentation and the actual shipped CLI surface.
  Evidence: `README.md` quick-start and overview already use `rvw setup`, `rvw repo add`, and `rvw daemon start`.

## Decision Log

- Decision: Promote `rvw` to the primary displayed CLI name but keep `reviewflux` in `package.json#bin` as a compatibility alias.
  Rationale: This matches the existing README and shortens the common command without breaking existing installs or scripts that still call `reviewflux`.
  Date/Author: 2026-03-18 / Codex

## Outcomes & Retrospective

ReviewFlux now presents `rvw` as the primary CLI invocation across package bins, Commander help output, next-step hints, and README examples. The legacy `reviewflux` executable still exists as a compatibility alias, so this rollout shortens the common command path without breaking older local scripts.

The final change stayed intentionally narrow: package name, config directories, queue DB names, and `[reviewflux]` log prefixes remain unchanged because they are internal or persisted identifiers rather than the interactive CLI surface. The visible command contract is the only thing that shifted.

## Context and Orientation

The root Commander program name is owned by `src/commands/help/index.ts` and used by `src/cli/program.ts`, which means changing `PROGRAM_NAME` updates most generated help text. The published binary names come from `package.json#bin`, and local developer runners live in `package.json#scripts`.

Beyond generated help, a few hard-coded operator hints still mention the old command name in `src/commands/setup/index.ts` and `src/commands/daemon/start.ts`. Tests in `tests/cli-program.test.ts`, `tests/daemon-command.test.ts`, `tests/repo-command.test.ts`, `tests/setup-command.test.ts`, and `tests/root-args.test.ts` assert the displayed command name directly and will need updating.

## Plan of Work

First, update the command identity at the package and Commander layers. `package.json` should publish both `rvw` and `reviewflux`, and `PROGRAM_NAME` should become `rvw` so generated help output follows the preferred invocation automatically.

Next, clean up the remaining hard-coded hints that still tell users to run `reviewflux ...`. Those hints should use `rvw ...` anywhere they are teaching the interactive command line, while internal names such as `ReviewFlux`, `.reviewflux`, log prefixes, and package name can stay unchanged.

Finally, update tests and README wording to reflect the alias model, then run type-checking, linting, build, and the impacted test suites. A full `pnpm test:all` is the strongest final proof if time permits.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test -- --run tests/cli-program.test.ts tests/daemon-command.test.ts tests/repo-command.test.ts tests/setup-command.test.ts tests/root-args.test.ts`
Expected: all affected CLI naming tests pass with `rvw` as the displayed command name.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test:all`
Expected: build, check, lint, depcruise, and the full test suite all pass on the renamed command surface.

## Validation and Acceptance

Acceptance requires:

- `package.json` publishes `rvw` and still supports `reviewflux`
- Commander help displays `rvw ...`
- user-facing next-step hints say `rvw ...`
- affected tests pass
- repository validation stays green

## Idempotence and Recovery

This work is safe to retry. The command alias change is additive at the package level because `reviewflux` stays published. If a follow-up needs to revisit compatibility, it can change only the displayed help name while leaving the extra bin entry intact.

## Artifacts and Notes

- `package.json` now publishes both `rvw` and `reviewflux`, and adds a matching `pnpm rvw` local script.
- `src/commands/help/index.ts` sets the displayed Commander program name to `rvw`.
- `src/commands/setup/index.ts` and `src/commands/daemon/start.ts` now suggest `rvw ...` in operator-facing hints.
- CLI naming tests were updated across `tests/cli-program.test.ts`, `tests/daemon-command.test.ts`, `tests/repo-command.test.ts`, `tests/setup-command.test.ts`, and `tests/root-args.test.ts`.

## Interfaces and Dependencies

- `package.json#bin` should expose both command names.
- `src/commands/help/index.ts` remains the source of truth for the displayed root program name.
- internal product identifiers like `.reviewflux`, package name `reviewflux`, and `[reviewflux]` log prefixes are not in scope for renaming here.

## Revision Notes

- 2026-03-18 - Created the plan after the user requested that the real CLI command surface match the README's `rvw` usage.
- 2026-03-18 - Marked the rollout complete after package, help text, hints, docs, and tests were all updated and `pnpm test:all` passed.
