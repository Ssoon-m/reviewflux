# Adaptive Polling and Targeted Re-Poll

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux currently uses a fixed daemon poll interval and each project poll cycle performs a repo-wide open-PR scan plus repo-wide issue-comment and review-comment scans. That keeps correctness simple, but it makes quiet repositories pay the same remote cost as busy ones. The goal of this track is to keep the local, webhook-free daemon model while reducing GitHub API load through cheaper per-cycle checks, targeted re-poll of changed PRs, and slower repo-wide manual-trigger backstops.

After this change, operators should still see the same review behavior for opened PRs, new commits, and `@reviewflux` manual triggers, but quiet repositories should perform fewer expensive comment-feed scans. Busy repositories and recently changed PRs should stay responsive because the common 30-second path becomes cheap detect plus targeted refresh instead of repo-wide comment scanning. Observable success means daemon logs show fewer repo-wide expensive scans, targeted tests still prove queue correctness, and manual trigger latency on quiet repositories is bounded by an explicit backstop interval rather than every general poll cycle.

## Progress

- [x] (2026-03-18 01:55Z) Re-read `src/commands/daemon/start.ts`, `src/review/queue/poll-coordinator.ts`, `src/review/queue/poll-state-store.ts`, `src/review/queue/schema.ts`, and queue/daemon tests to confirm the current fixed-interval repo-wide polling shape.
- [x] (2026-03-18 02:10Z) Drafted the adaptive polling design around cheap PR-head detection, targeted PR refresh, and slower manual-trigger backstop scans.
- [x] (2026-03-18 05:30Z) Added additive poll state for per-PR targeted refresh and slower manual backstop timing, and updated `docs/generated/db-schema.md`.
- [x] (2026-03-18 05:31Z) Split poll coordination into cheap detect, targeted refresh, and manual backstop sweep paths while preserving transactional enqueue + snapshot persistence.
- [x] (2026-03-18 05:32Z) Kept the daemon loop fixed at the current cadence and limited repo-level timing to the slower repo-wide manual backstop path.
- [x] (2026-03-18 05:35Z) Added regression coverage for targeted refresh and manual-backstop timing, then ran validation (`pnpm check`, `pnpm build`, `pnpm depcruise`, and Vitest coverage for queue/daemon paths plus a focused manual QA scenario).

## Surprises & Discoveries

- Observation: the daemon currently calls `pollProject(project)` for every configured project on every cycle after a single fixed `REVIEWFLUX_POLL_INTERVAL_MS` sleep.
  Evidence: `src/commands/daemon/start.ts` constructs one `ReviewPollCoordinator`, loops over every project inside `runDaemonCycle`, and then sleeps the fixed interval before the next cycle.

- Observation: one `pollProject` call always performs all three remote reads for an initialized repository: open pull requests, repo-wide issue comments, and repo-wide review comments.
  Evidence: `src/review/queue/poll-coordinator.ts` calls `listOpenPullRequests(...)`, `ghApiPaginatedJson(.../issues/comments)`, and `ghApiPaginatedJson(.../pulls/comments)` inside `buildNextSnapshot(...)` for every initialized project.

- Observation: persisted queue poll state only tracks repo-level comment cursors and per-PR head SHAs, so the current runtime cannot express per-PR comment cursors, per-PR targeted refresh deadlines, or a slower repo-wide manual backstop timer.
  Evidence: `ProjectPollSnapshot` in `src/review/queue/types.ts` only contains `lastSeenIssueCommentId`, `lastSeenReviewCommentId`, and `prHeads`.

- Observation: manual-trigger correctness currently depends on repo-wide comment feeds, and no checked-in code proves that a PR-level metadata field alone is a safe substitute for force-comment detection.
  Evidence: `src/review/queue/poll-coordinator.ts` only detects `manual_force` by scanning repo-wide comment feeds and then resolving the affected PR number.

- Observation: configured repository registration does not live in SQLite today; the daemon loads repositories from `config.projects`, while SQLite stores derived queue and poll state.
  Evidence: `src/commands/repo/add.ts` writes repository settings into `config.projects` and persists them through `saveConfig(config)`, while `src/commands/daemon/start.ts` loads `Object.values(config.projects ?? {})` before constructing `ReviewQueueDatabase`.

- Observation: `ReviewPollStateStore.saveProject(...)` currently deletes and recreates every `project_pr_heads` row for a repo on each save, which is acceptable for `head_sha` snapshots but will not safely preserve richer per-PR scheduler metadata.
  Evidence: `src/review/queue/poll-state-store.ts` deletes `project_pr_heads` rows for `repo_key` and then reinserts the current set from `snapshot.prHeads`.

## Decision Log

- Decision: keep polling as the correctness source of truth and keep webhooks out of scope for this track.
  Rationale: ReviewFlux is intentionally a local-install daemon (`npm install reviewflux` plus `rvw daemon start`). The performance work should reduce remote cost without introducing an externally hosted receiver or new deployment contract.
  Date/Author: 2026-03-18 / Codex

- Decision: split automatic review detection from manual-trigger detection instead of trying to infer both from one signal.
  Rationale: PR head changes and newly opened PRs are cheap to detect from the open-PR list. `@reviewflux` comments are more expensive and currently require comment-feed inspection. A slower manual-trigger backstop sweep preserves correctness without forcing every cycle to pay the full repo-wide comment cost.
  Date/Author: 2026-03-18 / Codex

- Decision: keep the outer daemon loop and worker-drain sequencing stable in the first rollout; make adaptive behavior happen inside the queue polling path.
  Rationale: The expensive part is remote GitHub I/O, not the local `setTimeout` wakeup. Preserving the existing daemon loop in `src/commands/daemon/start.ts` keeps abort handling, stale-job recovery, and operator-visible startup behavior stable while still removing most unnecessary remote requests.
  Date/Author: 2026-03-18 / Codex

- Decision: evolve the existing poll tables additively instead of introducing a second queue database or a destructive table rename in the first rollout.
  Rationale: Queue state already lives in SQLite and the queue invariants require durable, restart-safe cursors. Adding scheduling columns to `project_poll_state` and extending `project_pr_heads` with per-PR refresh metadata keeps migration risk lower than inventing a parallel store.
  Date/Author: 2026-03-18 / Codex

- Decision: expose scheduler tuning through environment variables first, not through per-project config schema changes.
  Rationale: The daemon already uses env vars such as `REVIEWFLUX_POLL_INTERVAL_MS`, `REVIEWFLUX_JOB_RETRY_DELAY_MS`, and `REVIEWFLUX_JOB_STALE_RUNNING_MS`. Keeping the first rollout in that channel limits CLI/config churn and gives operators a reversible escape hatch while the heuristics settle.
  Date/Author: 2026-03-18 / Codex

- Decision: keep repository registration in `config.json` for the first rollout and treat SQLite as derived runtime state only.
  Rationale: The scaling problem is remote polling cost, not repository lookup cost. `rvw repo add`, `rvw repo list`, and daemon startup already treat `config.projects` as the operator-facing source of truth. Moving repository registration into SQLite would add migration and UX churn without reducing GitHub API work.
  Date/Author: 2026-03-18 / Codex

- Decision: replace full-table `project_pr_heads` rewrites with PR-scoped upsert/delete helpers before storing richer PR scheduler state there.
  Rationale: Once `project_pr_heads` carries per-PR cursors, refresh timestamps, or next-due deadlines, the current delete-and-reinsert save path would either drop metadata or force awkward state reconstruction on every cheap detect pass. PR-scoped writes keep targeted refresh state durable across cycles.
  Date/Author: 2026-03-18 / Codex

- Decision: keep the top-level repo poll cadence fixed at `REVIEWFLUX_POLL_INTERVAL_MS` for the first rollout and defer repo-level hot/warm/cold scheduling.
  Rationale: The biggest obvious win comes from removing repo-wide comment scans from the common path, while fixed 30-second detect passes preserve current new-PR latency expectations. Repo-level cadence adaptation adds more state and more latency risk than first-rollout value.
  Date/Author: 2026-03-18 / Codex

## Outcomes & Retrospective

No runtime code has landed yet. This plan currently captures the intended implementation shape and the constraints that emerged from reading the current queue runtime. The expected end state is not “polling removed”; it is “polling cost narrowed to cheap repo scans most of the time, with focused expensive reads only where recent activity makes them worthwhile.”

The implementation should leave ReviewFlux with the same durable queue contract it has today: first-seen priming still does not backfill old events, event enqueue plus cursor advancement still happen in one SQLite transaction, and `event_key` remains the dedupe boundary. What changes is how often the daemon asks GitHub expensive questions and how precisely it scopes follow-up scans after activity is detected.

## Context and Orientation

The current daemon entrypoint is `src/commands/daemon/start.ts`. It resolves config, loads all projects from `config.projects`, constructs the queue/database collaborators, and then calls `runDaemonCycle(...)` forever with a fixed `REVIEWFLUX_POLL_INTERVAL_MS` delay between cycles. `runDaemonCycle(...)` first recovers stale jobs, drains workers, then calls `coordinator.pollProject(project)` for every configured project, and finally drains workers again. The queue database is therefore not the canonical repository registry; it is a runtime state store keyed by repositories that were configured elsewhere.

The current polling implementation lives in `src/review/queue/poll-coordinator.ts`. For an uninitialized project it primes a baseline snapshot by storing the current open-PR heads and the latest repo-wide issue/review comment IDs without backfilling jobs. For an initialized project it always fetches the full open-PR list plus the repo-wide issue-comment and review-comment feeds, compares the new snapshot to the previous snapshot, and enqueues `pull_request`, `issue_comment`, and `pull_request_review_comment` jobs. Queue state is persisted through `src/review/queue/poll-state-store.ts`, and queue schema lives in `src/review/queue/schema.ts` with a checked-in snapshot in `docs/generated/db-schema.md`.

The important queue invariants are documented in `src/review/queue/AGENTS.md`. SQLite is the single local source of truth. First-seen priming must not backfill old events. Enqueueing jobs and saving the advanced poll snapshot must remain in one transaction. `event_key` remains the dedupe boundary. Any performance-oriented polling changes must preserve those rules.

Relevant tests already exist in `tests/review-poll-coordinator.test.ts`, `tests/review-queue.test.ts`, `tests/review-job-worker.test.ts`, `tests/review-queue-runtime.test.ts`, and `tests/daemon-start.test.ts`. The plan below assumes those tests are expanded rather than replaced.

## Detailed Runtime Shape

The first rollout should keep the operator-facing repository model exactly where it is now: `config.projects` remains the list of repositories to track. The queue database should continue to store only derived runtime state such as poll cursors, per-PR refresh metadata, and durable review jobs. That separation keeps `rvw repo add`, `rvw repo list`, and daemon startup behavior stable while the polling internals change.

One daemon cycle should stop meaning "do every expensive remote read for every repo." The daemon should keep its current fixed cadence, but each project poll should ask three narrower questions in order.

First, a cheap detect path should run on every project poll at the existing daemon cadence. This path should call the open-PR list endpoint, compare the remote PR set against local poll state, and classify PRs as `new`, `head_changed`, `updated`, `still_hot`, or `quiet`. The detect path should not touch repo-wide comment cursors. It should update per-PR refresh state and mark which PRs deserve targeted refresh work.

Second, a targeted refresh path should run only for PRs selected by the detect path or for PRs whose own next-refresh deadlines are due. This path should fetch PR-scoped comments rather than repo-wide feeds. ReviewFlux already has PR-scoped readers in `src/review/github.ts` for `issues/{pr}/comments` and `pulls/{pr}/comments`; the coordinator should reuse those readers instead of inventing a new remote abstraction. Targeted refresh should detect new `@reviewflux` manual triggers for that PR, preserve the current automatic `opened_once` / `on_push` behavior, and commit enqueue plus PR-state advancement in one transaction.

An unchanged old PR should stop at the cheap detect path. Concretely, if the cached `head_sha` still matches, the cached freshness signal such as `last_seen_updated_at` still matches the remote PR summary, and `next_targeted_refresh_at` is still in the future, that PR should not enter targeted refresh at all. Its steady-state cost should be one cheap comparison during the open-PR list pass, not a per-PR comment scan.

Third, a manual-trigger backstop sweep should continue to use the current repo-wide comment feeds, but it should run on its own slower per-repo schedule. This sweep is the correctness path for manual triggers on quiet PRs. It should be the only path allowed to advance repo-level `lastSeenIssueCommentId` and `lastSeenReviewCommentId`, because those cursors represent coverage of the whole repository feed rather than one PR.

The `project_poll_state` table should gain only the repo-level timing it still needs in the first migration. A concrete starting set is: `last_manual_backstop_at TEXT` and `next_manual_backstop_at TEXT`. If later measurements prove fixed-cadence cheap detect is still too expensive, repo-level cadence fields can be added in a second phase. The first rollout should not depend on repo temperature classes or a persisted next head-scan deadline.

The `project_pr_heads` table should evolve from a simple `head_sha` snapshot into PR-level refresh state. A concrete first set is: `last_seen_updated_at TEXT`, `last_seen_issue_comment_id INTEGER`, `last_seen_review_comment_id INTEGER`, `last_targeted_refresh_at TEXT`, and `next_targeted_refresh_at TEXT`, while keeping `head_sha` as the automatic-review trigger signal. Once these fields exist, `ReviewPollStateStore` should stop doing full delete-and-reinsert writes for the whole repo and instead provide explicit helpers to upsert changed PR rows, delete rows for PRs that closed, and update PR-level refresh metadata without blowing away neighboring state.

The remote type surface should stay cheap. `PullRequestSummary` should be extended to include the minimal freshness signal needed for dirty detection, ideally `updated_at`, so the detect path can notice non-head activity without immediately paying for per-PR comment scans. That signal should be treated as a hint to schedule targeted refresh, not as proof that a manual trigger was or was not present.

The scheduler heuristics should remain intentionally simple in the first rollout. Any new PR, head change, or detected manual trigger should shorten the affected PR follow-up interval via `next_targeted_refresh_at`. A separate manual-backstop interval should cap the worst-case delay for manual triggers on otherwise quiet repos. Keep `REVIEWFLUX_POLL_INTERVAL_MS` as the fixed top-level detect cadence, and expose the slower repo-wide backstop interval through environment variables first so the behavior is reversible without config-schema churn.

## First-Rollout Sequence

The safest implementation order is to separate the expensive paths before tuning anything else. Step one should add the new schema columns, update `docs/generated/db-schema.md`, and refactor `ReviewPollStateStore` away from whole-table rewrites for PR state. Step two should split `pollProject(...)` into explicit cheap-detect, targeted-refresh, and manual-backstop helpers while keeping the old transaction boundary semantics. Step three should keep the daemon's fixed cadence but gate only the slower repo-wide backstop work per repository. Step four should add observability and tests for cheap-detect behavior, targeted refresh counts, and manual-trigger backstop latency.

This sequence matters. Adaptive intervals by themselves do not buy enough while every due poll still performs repo-wide comment scans. The first material win comes from moving `issues/comments` and `pulls/comments` off the every-cycle path.

## Plan of Work

First, extend the queue poll state model so the daemon can remember which PRs need faster follow-up scans and when each repository last ran its slower manual backstop. `project_poll_state` only needs repo-level manual-backstop timing in the first rollout. `project_pr_heads` should stop being “head-only” in practice and gain additive metadata for targeted refresh work: the last seen PR `updated_at` value, the last seen issue/review comment IDs for that PR, and the next targeted refresh time. Keep the migration additive and update `docs/generated/db-schema.md` in the same change.

Second, refactor `src/review/queue/poll-coordinator.ts` so one project poll is no longer synonymous with “fetch everything expensive.” The coordinator should become a small orchestrator with three distinct paths:

1. A cheap detect path that lists open PRs and compares local state against remote `number`, `head.sha`, and remote update metadata. This path determines which PRs are dirty enough to justify focused follow-up work and updates repo/PR scheduling state.
2. A targeted refresh path that runs only for dirty or recently hot PRs. It fetches per-PR issue comments and review comments, detects new `@reviewflux` triggers using per-PR cursors, and enqueues jobs plus state updates in one SQLite transaction.
3. A slower manual-trigger backstop sweep that still uses repo-wide comment feeds, but only on a dedicated, slower cadence. This catches manual triggers on otherwise cold PRs and repairs any drift if the targeted path misses something.

Third, keep the daemon cycle and its worker-drain ordering unchanged. The queue polling collaborator should still run for every configured project on every cycle, but the common path should be cheap detect only, and the slower repo-wide manual backstop should run only when its per-repo deadline is due. This keeps signal handling, lifecycle behavior, and new-PR detection latency stable while still removing most unnecessary GitHub requests.

Fourth, improve observability so operators can tell what each fixed-cadence project poll decided to do. Add semantic logs for cheap head-scan results, targeted refresh counts, and manual-backstop sweep runs. The logs should report counts and schedule decisions, not raw tokens or secret-bearing URLs.

Finally, validate correctness and performance-oriented behavior together. The acceptance bar is not only “fewer requests”; it is “fewer expensive requests without changed review semantics.” The tests should prove that hot PRs stay responsive, cold repos back off, manual triggers on quiet repos are still detected within the configured backstop interval, and queue transaction rules remain unchanged.

The implementation should also make the storage split obvious in code and docs: repositories still come from `config.projects`, while `project_poll_state`, `project_pr_heads`, and `review_jobs` remain derived runtime state. The rollout should not introduce a second source of truth for "which repos are tracked" unless a later product requirement explicitly needs that change.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test -- --run tests/review-poll-coordinator.test.ts`
Expected: new scenarios pass for cheap detect, targeted PR refresh, manual-trigger backstop sweeps, and transactionally persisted state.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test -- --run tests/review-queue.test.ts`
Expected: additive schema/store migration coverage passes, including persisted repo/PR scheduling fields.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test -- --run tests/daemon-start.test.ts`
Expected: daemon cycle scenarios pass, including skipped cold projects, preserved stale-job recovery ordering, and unchanged abort behavior.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm depcruise`
Expected: no dependency violations after introducing any new queue scheduler/store modules.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test:all`
Expected: build, check, lint, depcruise, and the full Vitest suite stay green after the polling refactor.

## Validation and Acceptance

Acceptance requires all of the following:

- quiet repositories no longer fetch repo-wide issue-comment and review-comment feeds on every daemon cycle, even though they still participate in the fixed 30-second cheap-detect pass
- newly opened PRs and head-SHA changes still enqueue the same automatic review jobs as before
- manual `@reviewflux` triggers on quiet repositories are still detected within a documented backstop interval
- queue state updates remain durable and transactional: if jobs are enqueued, the corresponding poll cursor and targeted-refresh state advance in the same SQLite transaction
- daemon logs make it visible when a cheap detect pass found dirty PRs and when a manual backstop sweep ran
- targeted queue/daemon tests plus `pnpm test:all` all pass

For manual acceptance, use at least one quiet test repository and one recently active repository. A quiet repository should show repeated daemon cycles with cheap-detect logs but without repeated expensive comment-feed work. An active repository should show a head change triggering targeted refresh for the changed PR while the outer daemon cadence remains unchanged.

## Idempotence and Recovery

This work should be safe to retry incrementally. Keep schema changes additive, and do not remove the existing repo-wide manual-trigger sweep until the slower backstop replacement is fully wired. If an intermediate implementation proves unreliable, keep the current full-scan behavior behind the existing path and gate the adaptive behavior behind the new scheduler checks rather than deleting the old logic first.

If a schema migration goes wrong during development, delete the local queue DB in a temporary test home and rerun the targeted tests rather than trying to hand-edit SQLite state. If runtime behavior becomes ambiguous mid-refactor, prefer restoring the previous repo-wide scan callsites and landing the state/store groundwork separately before retrying the split.

## Artifacts and Notes

- Proposed scheduler env vars:
  `REVIEWFLUX_POLL_INTERVAL_MS` as the fixed top-level detect interval
  `REVIEWFLUX_POLL_TARGETED_REFRESH_INTERVAL_MS`
  `REVIEWFLUX_POLL_MANUAL_SWEEP_INTERVAL_MS`

- Dirty-PR heuristic for the first rollout:
  a PR is dirty when it is new locally, its `head.sha` changed, its remote `updated_at` changed, or its targeted-refresh deadline is due because the PR is still hot.

- Skip rule for old quiet PRs:
  if a PR is already known locally, `head.sha` is unchanged, `updated_at` is unchanged, and the PR-specific refresh deadline has not arrived, the coordinator should skip targeted refresh for that PR and leave it in the cheap-detect-only path.

- Manual-trigger correctness rule for the first rollout:
  do not assume PR `updated_at` alone is sufficient to replace comment-feed scanning. Keep a slower repo-wide manual-trigger backstop sweep until tests or probes prove a cheaper signal is safe.

## Interfaces and Dependencies

- `src/commands/daemon/start.ts` should continue to own the daemon loop, worker-drain ordering, signal handling, and operator-facing startup output.
- `src/review/queue/poll-coordinator.ts` should own cheap detect, targeted PR refresh, and manual-trigger backstop orchestration. It should not take over worker execution or generic scheduler concerns outside queue polling.
- `src/review/queue/poll-state-store.ts` should remain the single SQL owner for project-level and PR-level polling state. If helper methods grow too large, split them into queue-local store modules rather than pushing SQL into `src/lib`.
- `src/review/queue/schema.ts` and `docs/generated/db-schema.md` must stay in sync for any queue DB shape changes.
- `src/review/github.ts` should expose the remote reads needed for cheap PR scans and targeted per-PR refreshes without moving review semantics into the provider boundary.
- `tests/review-poll-coordinator.test.ts`, `tests/review-queue.test.ts`, and `tests/daemon-start.test.ts` are the minimum regression suite for this track.

## Revision Notes

- 2026-03-18 - Created this plan to guide the polling-performance refactor toward adaptive polling, targeted re-poll, and cheap remote checks without introducing webhooks or weakening queue invariants.
- 2026-03-18 - Landed the simplified first rollout: fixed 30-second repo cadence, cheap detect on every repo poll, per-PR targeted refresh, and slower repo-wide manual backstop timing. Deferred repo-level hot/warm/cold cadence changes to a later phase if measurement shows the open-PR list is still the dominant cost.
