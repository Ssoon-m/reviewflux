# Queue-Based Event Processing Plan

## Why This Work Is Needed

The daemon can receive burst traffic (for example, 10 PR events at once), but AI review generation is not instantaneous. Without a queue, burst handling can become inconsistent, error-prone, or difficult to scale. A queue-based flow provides predictable ordering, safer retries, and better daemon stability under load.

## Current State

- The gateway currently receives GitHub events and returns a review decision.
- There is no dedicated in-process job queue for review execution yet.
- Event bursts are not managed with explicit backpressure/concurrency controls.

## Goal

Implement a lightweight in-process queue for PR review jobs so that events are accepted quickly and processed safely with controlled concurrency.

## Scope (Phase 1)

1. Add an in-memory queue layer (recommended: `p-queue`).
2. Push incoming review-trigger events into the queue.
3. Process jobs with configurable concurrency (default: `1`).
4. Add retry policy for transient failures.
5. Add basic job logging (enqueue/start/success/fail).

## Out of Scope (Phase 1)

- Distributed workers across multiple processes.
- Durable external message broker integration (RabbitMQ/Redis/Kafka).
- Cross-platform webhook ingestion beyond current GitHub path.

## Implementation Outline

1. Create a queue module under `src/gateway/` or `src/infra/` for event jobs.
2. Define a typed job payload for PR review events.
3. Wire the HTTP event handler to enqueue jobs rather than execute heavy work inline.
4. Implement worker logic to call existing review flow.
5. Add configuration values for concurrency, retry count, and retry delay.

## Success Criteria

- Burst events are accepted without blocking request handling.
- Jobs are processed in controlled order/concurrency.
- Failed jobs are retried according to policy.
- Build and tests pass after integration.

## Risk Notes

- In-memory queues lose pending jobs if the process exits.
- If durability is required later, migrate to Redis/BullMQ or RabbitMQ.

## Next Step

After this plan is approved, implement Phase 1 with `p-queue`, then validate with burst event simulation tests.
