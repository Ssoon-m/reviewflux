# REVIEW QUEUE MAP

## SCOPE
This file applies to `src/review/queue/`. Also keep `src/review/AGENTS.md` in scope for broader review-runtime rules.

## ROLE
This file is the canonical home for queue runtime ownership, invariants, and verification expectations. Keep queue-specific rules here instead of creating a separate top-level queue runtime doc.

## HIGH-SIGNAL FILES
- `src/commands/daemon/start.ts` - drives polling cycles and worker-drain orchestration from outside this subtree.
- `src/review/queue/database.ts` - SQLite bootstrap and runtime support checks.
- `src/review/queue/schema.ts` - schema creation and migration steps.
- `src/review/queue/poll-state-store.ts` - durable poll cursors and PR-head state.
- `src/review/queue/job-store.ts` - enqueue, claim, heartbeat, complete, retry, and stale-running recovery operations.
- `src/review/queue/poll-coordinator.ts` - GitHub polling translated into enqueue candidates.
- `src/review/queue/job-worker.ts` - worker drain loop, ownership checks, retry scheduling, and heartbeat behavior.
- `src/review/queue/event-key.ts`, `src/review/queue/types.ts`, `src/review/queue/index.ts` - shared queue identity and exported surface.

## LOCAL INVARIANTS
- SQLite is the single local source of truth for queue state. Do not add a second queue abstraction without an explicit design change.
- Keep polling, persistence, and worker execution separated. Avoid introducing a monolithic queue manager.
- First-seen baseline priming must record current PR heads and latest manual-trigger cursors without backfilling old events.
- Enqueueing jobs and saving the advanced poll snapshot must stay in one transaction so cursor movement and durable work do not drift apart.
- `event_key` is the dedupe boundary for review jobs.
- Heartbeat ownership and stale-job recovery are correctness rules, not optional telemetry.
- Keep SQL concentrated in queue store modules. Only move code to a lower-level infra boundary when it is truly generic.
- Default execution is a local worker with conservative behavior; do not widen concurrency or retry semantics accidentally.

## REFERENCE DOC
- `docs/exec-plans/completed/queue-event-processing-plan.md` - long-form queue architecture, non-goals, and rollout rationale.

## TESTS TO CHECK
- `tests/review-queue.test.ts`
- `tests/review-poll-coordinator.test.ts`
- `tests/review-job-worker.test.ts`
- `tests/review-queue-runtime.test.ts`
- `tests/daemon-start.test.ts`
- `tests/daemon-status.test.ts`

## CHANGE CHECKLIST
- Re-run the most local queue test first, then the daemon-level test that exercises the changed path.
- Re-check stale-running recovery, retry scheduling, and heartbeat ownership whenever queue status transitions change.
- Update the queue plan doc if the underlying queue invariants or rollout assumptions materially change.
