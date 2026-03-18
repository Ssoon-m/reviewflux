# Add Changesets-Based NPM Release Automation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

After this change, ReviewFlux should have a concrete, repeatable release path for its npm CLI package. Maintainers should be able to record version intent with Changesets, tag a validated `main` commit, preview the release on tag push, and publish to npm through a manually approved trusted workflow instead of manually editing versions by hand.

## Progress

- [x] (2026-03-18 07:00Z) Installed `@changesets/cli` and initialized `.changeset/`.
- [x] (2026-03-18 07:03Z) Confirmed there are no existing local workflow files under `.github/workflows/`.
- [x] (2026-03-18 07:08Z) Added Changesets scripts to `package.json`, set `.changeset/config.json` access to `public`, and restored `src/commands/setup/REVIEWFLUX-AGENTS.md` to the publish allowlist.
- [x] (2026-03-18 07:11Z) Added `.github/workflows/release.yml` for tag-driven npm release preview plus manual publish automation.
- [x] (2026-03-18 07:15Z) Added `.changeset/few-hounds-relax.md` so the new release flow has a concrete release plan to process.
- [x] (2026-03-18 07:18Z) Verified package contents, release commands, and workflow syntax/behavior proxies locally.

## Surprises & Discoveries

- Observation: The current root `package.json` keeps drifting back to `"files": ["dist"]`, which drops `src/commands/setup/REVIEWFLUX-AGENTS.md` from the published tarball.
  Evidence: repeated `npm pack --dry-run --json` runs excluded the policy file whenever that path was not explicitly present in `package.json`.
- Observation: There are no checked-in GitHub workflow files yet, so the automation can be introduced without preserving prior CI conventions.
  Evidence: `.github/workflows/*` glob returned no files.

## Decision Log

- Decision: Use Changesets as the version source of truth for this single-package repo, but trigger publishing from git tags rather than a release PR workflow.
  Rationale: It fits the existing pnpm-based CLI package, removes manual version editing, and matches the requested tag-based release model while keeping version/changelog generation explicit.
  Date/Author: 2026-03-18 / OpenCode
- Decision: Keep the release automation CLI-only and avoid reviving the old `gateway/http-server` publish surface.
  Rationale: The documented product surface is the `rvw` / `reviewflux` CLI, and prior inspection showed `http-server` was not part of the documented npm contract.
  Date/Author: 2026-03-18 / OpenCode

## Outcomes & Retrospective

Changesets is now installed and wired into the repo's release surface. The package scripts expose `pnpm changeset`, `pnpm version-packages`, and `pnpm release`; the publish allowlist again includes `src/commands/setup/REVIEWFLUX-AGENTS.md`; a release workflow now previews matching `v*` tags that point to `main` and publishes from an explicit manual dispatch on that tag; and the repo now has an initial changeset so `pnpm changeset status --verbose` resolves to a concrete patch release plan instead of a configuration error.

## Context and Orientation

ReviewFlux is a single-package pnpm-based TypeScript CLI. The publishable package metadata lives in `package.json`, the build output is produced by `tsdown.config.ts`, and the runtime/setup path depends on `src/commands/setup/REVIEWFLUX-AGENTS.md` being present in the published tarball. Changesets initialization produced `.changeset/config.json` and `.changeset/README.md`. There are no existing automation workflows under `.github/workflows/`, so release automation must be introduced from scratch.

## Plan of Work

First, stabilize package-level release metadata. `package.json` needs Changesets scripts that match the existing `pnpm build` / `pnpm test:all` release posture, and it must continue to publish `src/commands/setup/REVIEWFLUX-AGENTS.md` alongside `dist/`.

Second, add the workflow automation. The workflow should fit a single-package repo: check out the repo, set up pnpm and Node, install dependencies, run the repo's existing validation command, preview a tagged release automatically, and publish to npm only from a manually dispatched run that targets a matching `v*` tag already reachable from `main`. The workflow should request only the permissions needed for read access and npm trusted publishing.

Third, verify the release path with observable evidence. That includes local package checks (`pnpm test:all`, `npm pack --dry-run --json`), Changesets CLI checks, and syntax validation of the workflow file plus manual execution of the same commands the workflow relies on.

That verification has now completed locally. The remaining task is the final background-doc review so the implemented workflow can be compared against the external references already in flight.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm add -D @changesets/cli`
Expected: `@changesets/cli` appears in `devDependencies`.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm changeset init`
Expected: `.changeset/config.json` and `.changeset/README.md` exist.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test:all`
Expected: build, typecheck, lint, dependency-cruiser, and vitest all pass.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `npm pack --dry-run --json`
Expected: tarball contains CLI build artifacts plus `src/commands/setup/REVIEWFLUX-AGENTS.md`.

## Validation and Acceptance

The change is complete when maintainers can run `pnpm changeset`, `pnpm version-packages`, and the workflow-backed publish path without hand-editing `package.json` versions. `npm pack --dry-run --json` must continue to include `src/commands/setup/REVIEWFLUX-AGENTS.md`. The workflow YAML must parse successfully, and the underlying release commands it runs must succeed locally.

## Idempotence and Recovery

Changesets initialization is additive and safe to rerun only if `.changeset/` has not already been customized. Workflow edits are safe to retry because there is no existing local workflow to preserve. If package contents regress, restore `package.json#files` to include `src/commands/setup/REVIEWFLUX-AGENTS.md` before attempting publish again.

## Artifacts and Notes

- External references being used for workflow design: `code-yeongyu/oh-my-openagent`, `openclaw/openclaw`, and `facebook/react` workflow examples, plus official Changesets guidance.
- Verification evidence captured during implementation:
  - `pnpm test:all` passed.
  - `pnpm changeset --help` printed the expected command set.
  - `pnpm changeset status --verbose` resolved `reviewflux` to `0.1.1` via `.changeset/few-hounds-relax.md`.
  - `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/release.yml'); puts 'yaml ok'"` succeeded.
  - `npm pack --dry-run --json` produced a 9-file tarball including `src/commands/setup/REVIEWFLUX-AGENTS.md`.

## Interfaces and Dependencies

- `package.json`
- `.changeset/config.json`
- `.changeset/README.md`
- `.github/workflows/`
- `src/commands/setup/REVIEWFLUX-AGENTS.md`
- `@changesets/cli`

## Revision Notes

- 2026-03-18 - Created the initial exec plan for Changesets plus GitHub Actions npm release automation.
- 2026-03-18 - Updated progress and evidence after implementing package scripts, workflow automation, and local verification.
