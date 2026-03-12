# SQLite-Backed Review Queue and State Plan

## Why This Work Is Needed

The current daemon persists review state in `~/.reviewflux/daemon-state.json` and
processes review triggers inline from the polling loop. That combination creates
three problems:

- stale or partially incompatible JSON state can replay old triggers;
- completed work is only durable after the outer poll loop saves state;
- there is no durable queue for pending review jobs when the process exits.

We want a single local source of truth that survives restarts and models review
triggers as consumable jobs instead of repeatedly rescanning historical data.

## Goal

Replace the JSON daemon state and ad-hoc trigger dedupe with a SQLite-backed
store that manages:

- project polling state;
- PR head tracking;
- durable review jobs;
- retry and completion metadata for trigger processing.

## Non-Goals

- distributed workers across multiple hosts;
- external brokers such as Redis, RabbitMQ, or Kafka;
- generic ORM adoption for the whole codebase;
- refactoring unrelated CLI, LLM, or auth behavior.

## Library Choice

Initial implementation choice: use `node:sqlite` with raw SQL behind a small
queue database wrapper.

Why:

- zero extra runtime dependency for the CLI;
- the daemon is a single-process local worker;
- sync transactions simplify queue claim/ack flows;
- we only need a small number of targeted tables;
- raw SQL keeps queue semantics explicit.

If `node:sqlite`'s experimental status becomes a packaging concern later, we can
swap the connection layer to `better-sqlite3` without changing the higher-level
review job and state interfaces.

## Queue Strategy

Phase 1 and Phase 2 intentionally do not use `p-queue`.

Initial execution model:

- SQLite is the only durable queue;
- one local worker claims and executes jobs sequentially;
- default worker concurrency is `1`.

Why:

- a second queue abstraction would duplicate responsibility;
- SQLite already gives us ordering, durability, retry metadata, and dedupe;
- single-worker execution is safer while review posting semantics are still
  being stabilized.

If higher throughput is needed later, we can add multi-worker claim logic on top
of SQLite without changing the queue ownership model.

## Current Problems

### JSON State Weaknesses

- `daemon-state.json` is schema-light and silently normalizes missing fields.
- bounded arrays such as `seenForceCommentIds` and `postedReviewKeys` are used
  as dedupe memory even though the daemon rescans historical GitHub resources.
- state is saved at the end of the poll loop, so interruption can replay work.

### Missing Durable Queue

- review triggers are discovered and executed in the same loop;
- pending work is lost if the process exits between discovery and completion;
- there is no durable retry metadata or recovery of in-flight work.

## Target Architecture

SQLite becomes the single local source of truth for review execution state.

### Runtime Responsibilities

- `src/commands/daemon/start.ts`
  - polls GitHub;
  - derives trigger candidates;
  - enqueues jobs into SQLite;
  - runs or wakes a local worker loop.
- `src/review/`
  - owns review-specific state, queue, and worker logic;
  - remains responsible for review trigger semantics.
- `src/infra/` (new)
  - may host the low-level SQLite connection/bootstrap utility only if the
    connection code is truly generic.

## Data Model

### `project_poll_state`

One row per tracked repo.

- `repo_key TEXT PRIMARY KEY`
- `initialized INTEGER NOT NULL`
- `last_seen_issue_comment_id INTEGER`
- `last_seen_review_comment_id INTEGER`
- `bootstrapped_at TEXT`
- `updated_at TEXT NOT NULL`

Purpose:

- marks whether a repo has been baseline-primed;
- tracks monotonic cursors for manual trigger comment streams.

### `project_pr_heads`

One row per open PR head snapshot.

- `repo_key TEXT NOT NULL`
- `pr_number INTEGER NOT NULL`
- `head_sha TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- primary key: `(repo_key, pr_number)`

Purpose:

- determines whether a PR is newly opened, synchronized, or closed since the
  last poll.

### `review_jobs`

Durable review queue.

- `id INTEGER PRIMARY KEY`
- `repo_key TEXT NOT NULL`
- `pr_number INTEGER NOT NULL`
- `reason TEXT NOT NULL`
- `event_name TEXT NOT NULL`
- `event_key TEXT NOT NULL UNIQUE`
- `payload_json TEXT NOT NULL`
- `status TEXT NOT NULL`
- `attempts INTEGER NOT NULL DEFAULT 0`
- `available_at TEXT NOT NULL`
- `claimed_at TEXT`
- `completed_at TEXT`
- `last_error TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Status values:

- `pending`
- `running`
- `done`
- `failed`

Purpose:

- durable queue for automatic and manual review triggers;
- unique `event_key` enforces idempotent enqueue.

### Optional Cleanup Policy

Completed jobs should remain for a short retention window instead of being
deleted immediately.

Initial plan:

- keep `done` jobs for 24 hours;
- keep `failed` jobs until manually inspected or until TTL cleanup is added.

This preserves debugging visibility while still allowing periodic cleanup.

## Event Identity

Each enqueue candidate must map to a deterministic `event_key`.

Examples:

- `issue_comment:123456`
- `pull_request_review_comment:987654`
- `pr_opened:ssoon-m/reviewflux:13:<head_sha>`
- `pr_sync:ssoon-m/reviewflux:13:<head_sha>`

`INSERT OR IGNORE` on `event_key` becomes the dedupe boundary instead of
bounded in-memory arrays.

## Processing Flow

### Baseline Prime

When a repo is first seen:

1. create or load the `project_poll_state` row;
2. snapshot current open PR heads into `project_pr_heads`;
3. record the latest known issue/review comment cursors without enqueueing old
   manual triggers;
4. persist baseline immediately.

This keeps startup behavior as “no backfill unless a new event appears after
prime”.

### Poll Loop

For each configured repo:

1. load current polling state from SQLite;
2. fetch open PRs and compare with `project_pr_heads`;
3. enqueue `opened_once` / `on_push` jobs using deterministic `event_key`s;
4. fetch manual trigger comments newer than the stored cursor;
5. enqueue `manual_force` jobs;
6. advance cursors and PR head snapshots transactionally.

### Worker Loop

The worker repeatedly:

1. claims the next `pending` job whose `available_at <= now`;
2. marks it `running` in a transaction;
3. executes existing review logic through `runQueuedReviewJob()`;
4. marks success as `done` or schedules retry by updating `attempts`,
   `available_at`, and `last_error`.

### Recovery

On daemon startup:

- any `running` job older than a lease timeout is reset to `pending`;
- cleanup can archive or delete very old `done` jobs.

## Module Plan

### New or Changed Modules

- `src/review/queue/database.ts`
  - owns SQLite connection lifecycle, pragmas, and transaction entrypoints.
- `src/review/queue/schema.ts`
  - owns schema bootstrap and migration statements.
- `src/review/queue/poll-state-store.ts`
  - owns project poll state and PR head persistence.
- `src/review/queue/job-store.ts`
  - owns durable queue operations such as enqueue, claim, complete, retry, and
    cleanup.
- `src/review/queue/job-worker.ts`
  - owns the worker loop that consumes `review_jobs`.
- `src/review/queue/types.ts`
  - owns queue DTOs and status enums shared by the queue modules.
- `src/review/state-store.ts`
  - becomes a compatibility layer or is removed once SQLite state fully
    replaces JSON helpers.
- `src/commands/daemon/start.ts`
  - split into poller orchestration + worker orchestration.

If the SQLite connection bootstrap becomes generic enough, move only that part
to `src/infra/sqlite/connection.ts`. Domain-specific queue/state logic should
stay in `src/review/`.

## Queue Class Design

The queue implementation should avoid a single “manager” object that owns every
step of polling, enqueueing, and execution.

Recommended class boundaries:

### `ReviewQueueDatabase`

Responsibility:

- open the SQLite database;
- apply pragmas such as WAL mode and busy timeout;
- bootstrap schema and expose typed transaction helpers.

Must not contain:

- review trigger rules;
- GitHub polling logic;
- retry policy decisions beyond transaction primitives.

### `ReviewPollStateStore`

Responsibility:

- load or initialize `project_poll_state`;
- read and replace `project_pr_heads`;
- advance manual trigger cursors transactionally.

Must not contain:

- worker claim logic;
- review execution;
- GitHub API calls.

### `ReviewJobStore`

Responsibility:

- enqueue jobs with `event_key` idempotency;
- claim the next runnable job;
- mark jobs `done`, `failed`, or re-scheduled;
- recover stale `running` jobs;
- delete or archive expired completed jobs.

Must not contain:

- direct calls to `runReviewJob()` or `runQueuedReviewJob()`;
- project polling decisions.

### `ReviewJobWorker`

Responsibility:

- continuously claim jobs from `ReviewJobStore`;
- invoke `runQueuedReviewJob()` for claimed payloads;
- translate execution result into `complete`, `retry`, or `fail`.

Must not contain:

- SQL statements inline if they belong in the stores;
- GitHub polling and baseline prime logic.

### `ReviewPollCoordinator`

Responsibility:

- invoked from the daemon command;
- polls GitHub for each configured repo;
- computes enqueue candidates;
- delegates all persistence to `ReviewPollStateStore` and `ReviewJobStore`.

Must not contain:

- SQLite connection bootstrap details;
- worker internals.

## Queue Coding Rules

- keep SQL in queue store modules, not scattered through daemon commands;
- all queue writes that must be atomic should be wrapped in one transaction;
- use deterministic `event_key` creation helpers instead of formatting strings
  ad hoc at call sites;
- prefer explicit methods like `enqueueManualTriggerJob()` over a generic
  `saveAnything()` API;
- keep worker payloads versioned or shape-checked before execution;
- keep queue logging at the enqueue/claim/complete/retry boundaries only.

## Migration Strategy

We should not blindly import `daemon-state.json` into SQLite because the current
JSON shape is already a source of replay bugs.

Initial migration rule:

1. create `~/.reviewflux/reviewflux.db`;
2. if legacy `daemon-state.json` exists, log that it is deprecated;
3. baseline-prime repos from live GitHub state instead of importing the JSON
   arrays;
4. optionally rename the legacy JSON file to `daemon-state.json.bak`.

This favors correctness over preserving brittle dedupe history.

## Rollout Phases

### Phase 1: SQLite Poll State

- add DB bootstrap and schema creation;
- replace JSON load/save in `state-store.ts`;
- keep current direct `runReviewJob()` execution path;
- verify that restart behavior no longer depends on JSON normalization.

### Phase 2: Durable Review Jobs

- add `review_jobs`;
- change the daemon poll loop from “discover and execute” to “discover and
  enqueue”;
- add a single local worker loop that consumes queued jobs.

### Phase 3: Retry and Recovery

- add attempt counting and retry delay policy;
- reset stale `running` jobs on startup;
- add bounded cleanup for `done` jobs.

### Phase 4: Cleanup

- remove obsolete JSON state code and references;
- update help text and docs that mention in-memory or JSON-backed behavior;
- trim runtime dedupe helpers that are made redundant by queue event keys.

## Verification Plan

### Automated Tests

- queue/state bootstrap creates the SQLite DB and schema;
- first daemon start primes baseline without backfilling old manual triggers;
- `manual_force` comment is processed once across daemon restarts;
- `opened_once` does not replay for already-open PRs after restart;
- duplicate enqueue attempts are ignored by `event_key`;
- `pending` jobs survive restart;
- stale `running` jobs are recovered on daemon restart;
- retry policy moves transient failures back to `pending`;
- cleanup removes or archives old `done` jobs as expected.

### Manual Verification

- `pnpm build`
- `pnpm check`
- `pnpm test`
- start daemon, interrupt mid-cycle, restart, and confirm no replay of already
  completed triggers;
- enqueue multiple manual triggers quickly and confirm durable serialized
  processing.

## Risks

- SQLite introduces a local database file and migration surface;
- `node:sqlite` is still newer than long-established third-party bindings;
- incorrect transaction boundaries could create duplicate or stuck jobs;
- keeping completed jobs forever would grow the DB unnecessarily.

## Open Questions

- Should completed jobs be deleted immediately or retained for a short TTL?
- What retry policy counts as transient vs permanent failure for GitHub and LLM
  errors?
- Do we want a small daemon status command extension that reports queued job
  counts once SQLite is live?

## Deliverable Summary

This plan replaces:

- JSON-backed daemon state;
- bounded array dedupe against full historical scans;
- non-durable trigger execution.

With:

- SQLite-backed polling state;
- SQLite-backed durable review jobs;
- explicit worker/retry/recovery semantics.
