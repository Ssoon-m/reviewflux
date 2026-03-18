## CODING CONVENTION

### Imports
- Use extensionless ESM imports for local files. The repo checks source with bundler-style module resolution and lets the build pipeline emit runtime-safe module specifiers.
- Use `node:` prefixes for Node builtins (`node:fs`, `node:path`, `node:timers/promises`).
- Keep imports grouped in this order when practical: Node builtins -> external packages -> internal modules.
- Use `import type` or inline `type` specifiers for type-only imports.
- Prefer named exports; the codebase rarely uses default exports.
- Architecture import boundaries are defined in `.dependency-cruiser.cjs`; both `pnpm depcruise` and `pnpm lint` should surface those violations from that single config.
- Local commits should pass `pnpm validate:pre-commit`; the Husky `pre-commit` hook runs that command automatically after install.

### Formatting
- Use double quotes and semicolons consistently.
- Preserve trailing commas and multiline object/array formatting when entries become dense.
- Keep one logical step per small helper; short local helpers are preferred over long inline blocks.
- Avoid decorative comments. Existing code is mostly self-documenting through small functions and precise names.

### Types
- `tsconfig.json` is `strict`; keep new code fully typed.
- Prefer explicit local type aliases for structured payloads, log records, and collaborator shapes.
- Prefer literal unions for small state machines (`"opened_once" | "on_push"`, logging events, statuses).
- Reuse existing exported domain types before inventing parallel shapes.
- Avoid introducing new `any`, `@ts-ignore`, or suppression-based shortcuts.

### Naming
- Use `camelCase` for functions, locals, and helper values.
- Use `PascalCase` for type aliases, classes, and collaborator interfaces.
- Use `SCREAMING_SNAKE_CASE` for module-level constants only.
- User-facing CLI terminology is now `repo` / `repository`, but persisted runtime config still uses `projects`; do not widen that rename casually.
- Prefer role-revealing names such as `buildRepoCommand`, `runDaemonCycle`, `resolveRepoModelSelection`, and `logReviewRuntimeEvent`.

### Error Handling
- Throw machine-readable error strings for expected validation failures (`repo_required`, `repo_format_invalid`, `repo_not_found:...`).
- When logging unknown errors, use `error instanceof Error ? error.message : String(error)`.
- Use empty `catch {}` only for intentionally best-effort operations such as optional file reads or cleanup; otherwise keep the error surfaced or logged.
- Keep validation close to input boundaries (CLI prompts, env parsing, model selection, queue/database setup).

### Logging And Output
- Use `console.log` / `console.error` for interactive CLI output.
- Use `logging()` from `src/infra/logging/index.ts` for durable operational events.
- Preserve `[reviewflux] ...` prefixes for human-facing CLI output.
- When logging structured operational data, sanitize secrets through the shared logging helpers instead of ad hoc redaction.
