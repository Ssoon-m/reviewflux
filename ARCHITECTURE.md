# ReviewFlux Architecture

ReviewFlux uses a layered domain architecture with explicit cross-cutting boundaries. Read this file when you need to answer two questions quickly:

1. Which boundary owns the behavior I need to change?
2. Which import directions are allowed from that boundary?

Do not read this as a promise that every feature fits one universal chain like `Types -> Config -> Repo -> Service -> Runtime -> UI`. This repository is better understood as a small number of domain layers, plus cross-cutting boundaries that multiple layers may depend on without turning them into a shared junk drawer.

## Bird's-Eye View

At runtime, ReviewFlux behaves like this:

- The shell layer starts commands and daemon loops.
- The review runtime layer decides whether work exists, turns events into durable jobs, and decides what a review means.
- The publishing boundary emits already-decided review output.
- Provider boundaries supply auth, model access, and external I/O.
- Cross-cutting boundaries provide contracts, config, logging, and small dependency-light helpers.

Current top-level dependency shape:

```text
┌─────────────────────────────────────────────────────────────┐
│ Shell Layer                                                 │
│ `src/cli` -> `src/commands`                                 │
└───────────────┬─────────────────────────────────────────────┘
                │ orchestrates
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Review Runtime Layer                                        │
│ `src/review` <-> `src/review/queue`                         │
└───────┬───────────────────────────────┬─────────────────────┘
        │ decides review meaning        │ emits results
        ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ Provider / Adapter Boundaries│   │ Publishing Boundary      │
│ `src/auth`                   │   │ `src/gateway`            │
│ `src/llm`                    │   └──────────────────────────┘
│ selected GitHub/SQLite glue  │
└───────────────┬──────────────┘
                │ depends on
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Explicit Cross-Cutting Boundaries                           │
│ `src/contracts` `src/config` `src/infra/logging` `src/lib` │
│ `src/types`                                                 │
└─────────────────────────────────────────────────────────────┘
```

The important idea is not the exact box names. The important idea is that ReviewFlux has a small number of domain-owning layers and a small number of shared boundaries that stay narrow, explicit, and dependency-light.

## Codemap

- `src/cli` and `src/commands` are the shell layer. They parse argv, run daemon loops, print operator-facing output, and hand work to the owning boundaries. If a change starts with command UX, start here.
- `src/review` is the core review runtime boundary. It owns review meaning: review triggering semantics, review state, dedupe behavior, manual-trigger handling, and the top-level runtime flow in `runtime.ts`.
- `src/review/queue` is the durable execution half of the runtime layer. It owns polling snapshots, queue schema, job claiming, retries, stale recovery, and worker execution.
- `src/gateway` is the publishing boundary. It takes already-decided review output and turns it into outgoing comments or service responses. It should not decide review semantics.
- `src/auth` is a provider boundary for authentication and token acquisition.
- `src/llm` is a provider boundary for model selection, prompt assembly plumbing, and provider client integration.
- `src/contracts` is for explicit shared contracts that multiple higher-level boundaries must interpret the same way. This is the place for stable shared formats or wrappers, not for business orchestration.
- `src/config` owns environment and home-path glue such as `reviewflux-home.ts`. It is cross-cutting support, not a domain owner.
- `src/infra/logging` owns durable operational logging and redaction. Treat it as a cross-cutting operational boundary.
- `src/lib` is for small reusable helpers that do not naturally belong to one domain owner, stay dependency-light, and do not speak heavy domain language. The current repo-key normalization helper is the model to follow.
- `src/types` is for ambient or compatibility declarations only. Do not turn it into a second implementation layer.

## Layer Responsibilities

### Shell Layer

The shell owns:

- CLI command registration and argv handling
- operator-facing start/stop/status flows
- daemon loop orchestration

The shell does not own:

- review semantics
- queue state transitions
- LLM prompt contracts
- publishing decisions

### Review Runtime Layer

The review runtime owns:

- what events should produce review work
- what makes a review duplicate or already handled
- how review state is stored and interpreted
- how model output becomes actionable findings

This is the center of the product. If the question is "what does ReviewFlux mean by a review," this is the owning layer.

### Publishing Boundary

The publishing boundary owns:

- how decided findings are emitted
- inline versus top-level delivery mechanics
- publishing-specific normalization

It does not own review meaning. The review runtime decides what should be said; gateway code decides how to deliver it.

### Provider / Adapter Boundaries

The provider boundaries own:

- auth and token refresh
- model client setup and provider-specific behavior
- external service plumbing that should not become review meaning

They provide capabilities inward. They should not become the home for command flow or review policy.

### Explicit Cross-Cutting Boundaries

Cross-cutting boundaries exist because some responsibilities are shared across layers without belonging to one domain owner. In this repo they include:

- `src/contracts` for shared contracts that multiple boundaries must parse or emit consistently
- `src/config` for environment and path resolution
- `src/infra/logging` for operational evidence and secret-safe logging
- `src/lib` for dependency-light helpers
- `src/types` for ambient declarations

Cross-cutting does not mean "put anything shared here." It means "this concern legitimately spans multiple boundaries, so give it an explicit narrow home."

## Dependency Direction

- `src/cli` and `src/commands` may depend inward on `src/review`, `src/review/queue`, `src/gateway`, `src/auth`, `src/llm`, and the cross-cutting boundaries.
- `src/review` and `src/review/queue` may depend on provider boundaries and cross-cutting boundaries. They may call into `src/gateway` to publish already-decided results.
- `src/gateway` may depend on cross-cutting boundaries. The standalone HTTP server path may compose `src/config` plus `src/llm`, but gateway code should not pull review semantics inward.
- `src/auth` and `src/llm` may depend on cross-cutting boundaries and selected shared operator config from `src/cli/config.ts`, but they should not own command flow or durable queue behavior.
- `src/contracts`, `src/config`, `src/infra/logging`, `src/lib`, and `src/types` should remain leaf-like. They must not depend on `src/commands`, `src/review`, `src/review/queue`, or `src/llm` behavior.

The notable legacy exception is `src/cli/config.ts`, which is still the shared operator-local config store and type home used from multiple places. Treat it as a practical exception, not a pattern to spread.

## Boundaries That Matter

- The boundary between shell and review runtime tells you where command flow stops and product behavior begins.
- The boundary between review runtime and publishing tells you whether the problem is review meaning or delivery mechanics.
- The boundary between review runtime and providers tells you whether the change is about policy/semantics or about service plumbing.
- The boundary around `src/contracts` tells you whether a shared format is truly cross-layer or is only pretending to be shared.
- The boundary around `src/infra/logging` tells you where operator evidence should be normalized and redacted once.

## Forbidden Edges To Avoid

- Do not let `src/commands/*` publish review output directly through ad hoc GitHub calls. Command flows should trigger runtime behavior and keep publishing downstream.
- Do not let `src/gateway/*` import `src/review/*` or `src/review/queue/*` to decide what to say.
- Do not let `src/config/*`, `src/contracts/*`, `src/infra/logging/*`, `src/lib/*`, or `src/types/*` import higher-level domain behavior.
- Do not move review-job state, publishing rules, or provider orchestration into `src/lib`.
- Do not create a `constants` bucket that hides ownership. If a value matters across boundaries, name the contract or boundary it belongs to.

## Top-Level Import Guide

- `src/cli` may import local CLI helpers, `src/commands`, and low-level config/path helpers.
- `src/commands` may import `src/cli`, `src/review`, `src/review/queue`, `src/gateway`, `src/auth`, `src/llm`, and the cross-cutting boundaries for orchestration.
- `src/review` may import `src/gateway`, `src/auth`, `src/llm`, `src/config`, `src/contracts`, `src/infra/logging`, `src/lib`, and the `src/review/queue` sub-boundary.
- `src/review/queue` may import queue-local modules, selected `src/review` entrypoints/types, `src/config`, `src/contracts`, `src/infra/logging`, and `src/lib`.
- `src/gateway` may import gateway-local modules plus `src/contracts`, `src/config`, and other cross-cutting boundaries, but it should not import review semantics.
- `src/auth` and `src/llm` may import cross-cutting boundaries and selected shared operator config/types, but should stay provider-focused.
- `src/contracts` should expose stable, dependency-light shared contracts only.
- `src/config`, `src/infra/logging`, and `src/lib` should stay leaf-like.
- `src/types` should remain declaration-only support.

## Cross-Cutting Concerns

- Repository guidance crosses setup, config, `src/llm`, and `src/review`. If review quality changes, inspect the whole path instead of assuming it is only a prompt issue.
- Queue execution starts from daemon orchestration in `src/commands/daemon/start.ts`, but queue ownership stays in `src/review/queue`.
- Operator evidence crosses most of the system through `src/infra/logging`; make logging and redaction decisions once there.
- Shared published-review formats belong in `src/contracts` when multiple boundaries must produce or interpret them consistently.

## Practical Placement Rules

When deciding where code should live, ask these questions in order:

1. Does this code decide what ReviewFlux means? Put it in `src/review` or `src/review/queue`.
2. Does this code only decide how output is delivered? Put it in `src/gateway`.
3. Does this code adapt an external provider or credential model? Put it in `src/auth` or `src/llm`.
4. Is this a stable contract that multiple higher-level boundaries must share? Put it in `src/contracts`.
5. Is this only a small dependency-light helper with one clear purpose and no heavy domain language? Put it in `src/lib`.

If none of those answers feel clean, the boundary is probably still unclear and should be made explicit before adding code.
