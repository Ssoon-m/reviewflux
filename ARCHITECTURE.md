# ReviewFlux Architecture

This file is the physical codemap for ReviewFlux. Read it when you need to answer two questions quickly: where does the code that does X live, and what is the role of the area I am looking at?

## Bird's-Eye View

ReviewFlux is a local, CLI-first pull request review daemon. An operator runs setup, registers repositories, and starts a daemon. The daemon watches GitHub, turns review-worthy events into durable local queue jobs, asks the review runtime to build model input from repository guidance plus PR context, and sends the resulting findings to the publishing boundary.

The architecture is centered on separation of concerns: commands on the outside, review semantics in the middle, a durable local queue for execution state, and publishing/logging boundaries around the edges.

Current top-level dependency shape:

```text
┌───────────────────────────────────────────────┐
│ Shell boundary                                │
│ `src/cli` -> `src/commands`                   │
└──────┬───────────────────────────┬────────────┘
       │ orchestrates runtime      │ uses support directly
       ▼                           ▼
┌────────────────────────────┐   ┌─────────────────────────────┐
│ Review runtime boundary    │   │ Support boundaries          │
│ `src/review` <->           │   │ reused from shell/runtime   │
│ `src/review/queue`         │   │ `src/auth`                  │
└─────────────┬──────────────┘   │ `src/llm`                   │
              │ emits decided    │ `src/config`                │
              │ results          │ `src/lib`                   │
              ▼                  │ `src/infra/logging`         │
      ┌─────────────────────┐    └─────────────────────────────┘
      │ Publishing boundary │
      │ `src/gateway`       │
      └─────────────────────┘
```

Keep the diagram coarse. The important exceptions stay in prose: `src/cli/config.ts` is still a shared operator-local config/type home, and `src/types` remains ambient declaration support rather than a behavior layer.

## Codemap

- `src/cli` and `src/commands` are the shell. They parse argv, build command flows, and hand work to the owning domains. If you are changing user-visible command behavior, start with `src/commands/setup/index.ts`, `src/commands/repo/*`, or `src/commands/daemon/start.ts`, then follow the called domain from there. The notable exception is `src/cli/config.ts`, which owns persisted `config.json` / `auth.json` I/O for operator-local state.
- `src/config` owns home-path and environment glue such as `reviewflux-home.ts`. It defines where local state lives, but not the full persisted config store.
- `src/auth` owns provider-specific auth mechanics such as `pi-oauth.ts`. If the question is about OAuth flows or token refresh behavior, start here.
- `src/llm` owns model selection, provider integration, repository context loading, and prompt/output contracts. Use `project-context.ts` and `review-prompt.ts` as the main search anchors.
- `src/review` owns review meaning. The main anchors are `runtime.ts`, `github.ts`, and `state-store.ts`, plus the manual-trigger and fingerprint helpers that keep review behavior coherent.
- `src/review/queue` owns durable execution. The important anchors are `schema.ts`, `poll-state-store.ts`, `poll-coordinator.ts`, `job-store.ts`, and `job-worker.ts`. For a quick queue-schema lookup, `docs/generated/db-schema.md` is a hand-maintained checked-in snapshot; use it as a convenience reference, but treat `src/review/queue/schema.ts` as the source of truth.
- `src/gateway` is the publishing boundary. It takes internal review results and turns them into outgoing comments or service responses. Search here when the content is already decided and the problem is delivery.
- `src/infra/logging` owns durable operational logs and redaction rules. If the change affects what operators can inspect later, it should pass through this boundary.
- `src/lib` is for small reusable helpers that do not naturally belong to one of the domains above but are shared across multiple boundaries. The current example is repo key/input normalization in `src/lib/repo/input.ts`; code only belongs here when it stays dependency-light, easy to test, and named for one clear purpose.
- `src/types` is for ambient or compatibility declarations such as `clack-prompts.d.ts`. Keep it dependency-light and do not turn it into a second shared behavior layer.

## Architectural Invariants

- Keep the command layer thin. Commands orchestrate; they do not become the home for review, queue, or provider logic.
- Keep review semantics and publishing separate. `src/review` decides what the review means; `src/gateway` decides how it is emitted.
- Treat the local SQLite queue as the durable source of truth for pending review work. Do not introduce a second queue abstraction casually.
- Keep queue processing split across polling, persistence, and worker execution. The absence of a monolithic queue manager is intentional.
- Treat repository guidance as runtime behavior, not as decoration. Setup-seeded guidance, project context loading, and prompt assembly affect real review output.
- Treat logging as a boundary. Durable logs must remain useful to operators while preserving secret redaction.

## Boundaries That Matter

- The boundary between `src/commands` and the rest of the tree tells you where CLI flow ends and domain behavior begins.
- The boundary between `src/auth` / `src/config` and `src/commands` tells you whether a change is about setup/storage rules or only command UX.
- The boundary between `src/review` and `src/llm` tells you whether a change is about review semantics or about context/prompt/model plumbing.
- The boundary between `src/review` and `src/review/queue` tells you whether a change is about review meaning or durable execution.
- The boundary between `src/review` and `src/gateway` tells you whether you are deciding what to say or only how to publish it.
- The boundary around `src/infra/logging` tells you where operational evidence should be normalized and sanitized.

## Dependency Direction

- Treat `src/cli` and `src/commands` as one shell boundary. The shell may depend inward on `src/config`, `src/auth`, `src/llm`, `src/review`, `src/review/queue`, `src/infra/logging`, and `src/lib`. The rest of the tree should not depend on command builders, argv parsing, or interactive prompt code.
- The notable exception to that shell rule is `src/cli/config.ts`. It is currently the shared operator-local config store and type home, so selected modules in `src/auth`, `src/llm`, and `src/review` already depend on it.
- Treat `src/review` and `src/review/queue` as one review-runtime boundary at repo scale. `src/review` owns review meaning and `src/review/queue` owns durable execution, but they currently call each other directly as one runtime boundary.
- Treat `src/config`, `src/infra/logging`, and `src/lib` as low-level support boundaries. Many domains may depend on them, but they must not depend back on higher-level orchestration or absorb review, provider, or publishing semantics.
- Treat `src/gateway` as downstream publishing/composition. `src/review` may hand already-decided results to gateway helpers. The standalone HTTP server in `src/gateway/http-server.ts` may compose `src/config` plus `src/llm`, but gateway code should not pull review semantics or queue ownership inward.
- Treat `src/llm` as model and prompt plumbing. Commands and review runtime may depend on it. `src/llm` may depend on `src/auth`, `src/config`, `src/lib`, selected shared gateway types, and the shared operator config/types in `src/cli/config.ts`, but it should not become the home for command orchestration, durable queue state, or review meaning.

## Forbidden Edges To Avoid

- Do not let `src/commands/*` publish review output directly through `src/gateway`; command flows should trigger review or queue behavior and keep publishing downstream.
- Do not let `src/gateway/*` import `src/review/*` or `src/review/queue/*` to decide what to say; gateway code publishes already-decided results.
- Do not let `src/config/*`, `src/infra/logging/*`, or `src/lib/*` import `src/commands/*`, `src/review/*`, `src/review/queue/*`, or `src/llm/*`; those modules are support boundaries, not orchestrators.
- Do not move OAuth/profile logic, review-job state, pull-request behavior, or publishing logic into `src/lib`; if code speaks strong domain language, it belongs in its owning boundary.

## Top-Level Import Guide

- `src/cli` may import local CLI helpers, `src/commands`, and low-level config/path helpers. Keep it limited to argv, program wiring, and operator-local config I/O.
- `src/commands` may import `src/cli`, `src/auth`, `src/infra/logging`, `src/llm`, `src/review`, `src/review/queue`, and `src/lib` for orchestration. Do not let it become the permanent home for review semantics, queue state, provider mechanics, or reusable generic helpers.
- `src/config` should stay leaf-like. Do not import `src/commands`, `src/review`, `src/review/queue`, `src/gateway`, or `src/llm` from it.
- `src/auth` may import auth-local modules and the shared operator config/types in `src/cli/config.ts`. Do not couple it to command UX, review runtime, queue logic, or gateway publishing.
- `src/llm` may import `src/auth`, `src/config`, `src/lib`, selected `src/gateway` types, and the shared operator config/types in `src/cli/config.ts`. Do not move command flow, durable queue behavior, or review decision logic into it.
- `src/review` may import `src/auth`, `src/cli/config.ts`, `src/llm`, `src/gateway`, `src/infra/logging`, `src/lib`, and the `src/review/queue` sub-boundary. Do not import interactive command UX into it or turn it into the publishing boundary.
- `src/review/queue` may import queue-local modules, selected `src/review` runtime/types/github entrypoints, `src/config/reviewflux-home.ts`, `src/infra/logging`, and `src/lib`. Do not let it depend on `src/commands`, `src/gateway`, or general `src/llm` modules.
- `src/gateway` may import gateway-local modules, `src/config`, and the standalone HTTP-server path may import `src/llm`. It should not own review meaning, durable queue state, or command UX.
- `src/infra/logging` may import low-level config/path helpers only and should remain reusable from the rest of the tree.
- `src/lib` should remain leaf-like and domain-agnostic. It should not import domain modules.
- `src/types` should remain ambient/declaration-only support. Do not turn it into a second shared implementation layer.

## Cross-Cutting Concerns

- Repository guidance crosses setup, config, `src/llm`, and `src/review`. If review quality changes, inspect the whole path rather than assuming it is only a prompt issue.
- Queue execution starts from daemon orchestration in `src/commands/daemon/start.ts`, but queue ownership stays in `src/review/queue`. Keep the orchestration boundary and the queue boundary separate.
- Operator evidence crosses most of the system through `src/infra/logging`; logging and redaction choices should be made once and reused rather than reimplemented inside each domain.
