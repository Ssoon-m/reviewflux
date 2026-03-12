# AGENTS.md

This document defines directory responsibilities for the ReviewFlux codebase.
The goal is to keep architecture clear, modular, and easy to evolve.

## Core Principle

Organize by **role and responsibility**, not by file type.
Each directory should represent a stable domain boundary.

---

## Directory Ownership Rules

### `src/cli/`
- **Responsibility:** CLI entrypoint and argument routing only.
- **Must contain:** command parsing, dispatch wiring, top-level process handling.
- **Must NOT contain:** business logic, OAuth flow internals, daemon runtime logic.

### `src/commands/`
- **Responsibility:** user-invoked command handlers.
- **Structure:** command-group based subcommands.
  - Example: `commands/daemon/start.ts`, `commands/daemon/stop.ts`
- **Rule:** command handlers orchestrate use-cases; heavy reusable logic should be moved to dedicated domain modules.
- **Must NOT contain:** reusable helper modules that are not user-invoked commands (these should live in domain folders such as `src/llm/` or `src/gateway/`).
- **Naming rule:** files under `commands/<group>/` should read as subcommands, not shared internals.

### `src/commands/help/`
- **Responsibility:** help text and help command behavior.
- **Rule:** all help output should be centralized here.

### `src/auth/`
- **Responsibility:** authentication and token lifecycle logic.
- **Must contain:** OAuth helpers, token providers, auth-related validation.
- **Must NOT contain:** CLI prompt orchestration or HTTP server handlers.

### `src/llm/`
- **Responsibility:** model access adapters and LLM request/response handling.
- **Must contain:** provider clients, response parsing, model call abstractions.
- **Must NOT contain:** GitHub event routing or command dispatch.

### `src/gateway/`
- **Responsibility:** inbound/outbound integration boundaries (HTTP/webhook surface).
- **Must contain:** request handlers, protocol adapters, API-facing composition.
- **Must NOT contain:** CLI-specific parsing logic.

### `src/config/`
- **Responsibility:** runtime environment configuration schema and parsing.
- **Must contain:** env schema, validation, config shaping for runtime.

### `src/project/`
- **Responsibility:** project-scoped configuration helpers reused across commands/runtime.
- **Must contain:** repository input normalization, project review-mode parsing, and other project-specific shaping logic.
- **Must NOT contain:** interactive CLI prompts, LLM routing, or transport-specific gateway behavior.

### `src/lib/`
- **Responsibility:** domain-agnostic reusable modules with high internal cohesion.
- **Rule:** `lib` is not a dump folder. Group by cohesive capability (e.g., `lib/async`, `lib/text`, `lib/net`, `lib/validate`).
- **Rule:** modules in `lib` should be independently reusable and testable.
- **Must NOT contain:** domain language (`oauth`, `daemon`, `github`, `review`, etc.). If domain terms appear, move the logic back to its domain directory.
- **Promotion criteria (all recommended):**
  - reused in 2+ domains,
  - minimal external dependencies,
  - easy unit testing,
  - clear single-purpose naming.

### `src/infra/` (future)
- **Responsibility:** cross-cutting operational utilities (logging, retry policy wiring, process wrappers).
- **Rule:** keep infra generic; do not leak command/domain assumptions.

### `src/types/` (future)
- **Responsibility:** shared contracts and DTOs used across multiple domains.
- **Rule:** types here should be stable and dependency-light.

### `src/shared/` (future)
- **Responsibility:** small pure shared helpers.
- **Rule:** if logic grows domain-specific, move it to that domain directory.

---

## Command Layout Standard

Use nested subcommand layout:

- `commands/<group>/<subcommand>.ts`
- `commands/<group>/index.ts` as barrel export

Examples:
- `commands/daemon/start.ts`
- `commands/daemon/status.ts`
- `commands/setup/index.ts` (single-command groups still use folder + index)

---

## Change Policy

When adding new features:

1. Pick the domain directory by responsibility first.
2. Keep `src/cli` thin.
3. Avoid creating new root-level files in `src/`.
4. If a file does more than one domain role, split it before adding more logic.
5. Prefer explicit imports from domain modules over ad-hoc utility dumping.

---

## PR Expectations for Structure Changes

Any PR that changes structure should include:

- Why the boundary is improved
- What moved and why
- Out-of-scope items (what was intentionally not refactored)
- Build/test proof (`npm run build`, `npm test`)

---

## Naming Conventions

- Use `daemon` (not `deamon`).
- Use clear role-based names (`token-provider`, `http-server`, `client`, `index`).
- Avoid vague names like `misc`, `utils2`, `temp`, `legacy` in final architecture.
