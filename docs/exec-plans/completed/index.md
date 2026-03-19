# Completed Execution Plans

## Historical Plans
- `docs/exec-plans/completed/remove-ko-docs-and-fix-doc-tracking-plan.md` - remove Korean mirror docs and make direct docs under `docs/` trackable in this repo.
- `docs/exec-plans/completed/architecture-diagram-doc-plan.md` - compact top-level architecture diagram for the English and Korean architecture docs.
- `docs/exec-plans/completed/architecture-layering-doc-plan.md` - explicit dependency directions, forbidden edges, and top-level import guidance for the architecture docs.
- `docs/exec-plans/completed/queue-event-processing-plan.md` - SQLite-backed queue rollout and state migration plan.
- `docs/exec-plans/completed/layered-domain-architecture-and-review-format-contract.md` - reframe the repo as layered domain architecture with explicit cross-cutting boundaries and extract the shared review comment contract.
- `docs/exec-plans/completed/eslint-and-dependency-cruiser-adoption.md` - adopt ESLint and dependency-cruiser so code quality and documented boundary rules are enforced automatically.
- `docs/exec-plans/completed/eslint-dependency-cruiser-editor-integration.md` - surface `.dependency-cruiser.cjs` boundary violations through ESLint so editors show the same architectural errors as `pnpm depcruise`.
- `docs/exec-plans/completed/live-eslint-boundary-feedback.md` - make the ESLint dependency-cruiser adapter validate the current linted source so unsaved forbidden imports are reported immediately.
- `docs/exec-plans/completed/pr18-review-followups.md` - reconcile GitHub PR `#18` review feedback and lock in dependency-cruiser boundary direction semantics with tests.
- `docs/exec-plans/completed/extensionless-local-imports-adoption.md` - switch the repo to extensionless local imports while keeping build, lint, boundary validation, and tests green.
- `docs/exec-plans/completed/commit-and-push-validation-hooks.md` - install Husky so local commits run type-checking, lint, and dependency-cruiser validation, and local pushes rerun type-checking before leaving the machine.
- `docs/exec-plans/completed/rvw-command-alias-rollout.md` - make `rvw` the preferred CLI invocation across the shipped binary, help output, docs, and command hints while keeping `reviewflux` as a compatibility alias.
- `docs/exec-plans/completed/changesets-release-automation.md` - add Changesets-based versioning plus CI and GitHub Actions npm release automation for stable and prerelease CLI tags.

Use this directory to index plans that are no longer in flight but still explain why the current implementation looks the way it does.
