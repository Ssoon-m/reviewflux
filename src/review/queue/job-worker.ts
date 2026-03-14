import { randomUUID } from "node:crypto";
import { runQueuedReviewJob } from "../runtime.js";
import type { ReviewJobStore } from "./job-store.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delayIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export type ReviewJobWorkerOptions = {
  maxAttempts?: number;
  retryDelayMs?: number;
  staleRunningMs?: number;
  heartbeatIntervalMs?: number;
  workerId?: string;
};

function resolveHeartbeatIntervalMs(params: {
  staleRunningMs: number;
  requestedHeartbeatIntervalMs?: number;
}): number {
  const defaultInterval = Math.max(Math.floor(params.staleRunningMs / 3), 1_000);
  const requested = params.requestedHeartbeatIntervalMs ?? defaultInterval;
  return Math.min(Math.max(requested, 1_000), params.staleRunningMs);
}

export class ReviewJobWorker {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly staleRunningMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly workerId: string;

  constructor(
    private readonly jobStore: ReviewJobStore,
    options: ReviewJobWorkerOptions = {},
  ) {
    this.maxAttempts = Math.max(options.maxAttempts ?? 1, 1);
    this.retryDelayMs = Math.max(options.retryDelayMs ?? 30_000, 1_000);
    this.staleRunningMs = Math.max(options.staleRunningMs ?? 5 * 60_000, 5_000);
    this.heartbeatIntervalMs = resolveHeartbeatIntervalMs({
      staleRunningMs: this.staleRunningMs,
      requestedHeartbeatIntervalMs: options.heartbeatIntervalMs,
    });
    this.workerId = options.workerId ?? randomUUID();
  }

  recoverStaleRunningJobs(): number {
    return this.jobStore.recoverStaleRunningJobs(
      new Date(Date.now() - this.staleRunningMs).toISOString(),
    );
  }

  async drain(): Promise<number> {
    let processed = 0;

    while (true) {
      const job = this.jobStore.claimNextRunnableJob({ workerId: this.workerId });
      if (!job) break;

      console.log(
        `[reviewflux] review job started: ${job.repoKey}#${job.prNumber} key=${job.eventKey} attempt=${job.attempts}`,
      );

      let lostOwnership = false;
      const heartbeatTimer = setInterval(() => {
        const refreshed = this.jobStore.refreshRunningJobHeartbeat({
          jobId: job.id,
          workerId: this.workerId,
        });
        if (!refreshed && !lostOwnership) {
          lostOwnership = true;
          console.error(
            `[reviewflux] review job heartbeat lost ownership: ${job.repoKey}#${job.prNumber} key=${job.eventKey}`,
          );
        }
      }, this.heartbeatIntervalMs);

      try {
        await runQueuedReviewJob(job.payload);
        const markedDone = this.jobStore.markDone({
          jobId: job.id,
          workerId: this.workerId,
        });
        if (markedDone) {
          console.log(
            `[reviewflux] review job completed: ${job.repoKey}#${job.prNumber} key=${job.eventKey}`,
          );
        } else {
          console.error(
            `[reviewflux] review job completion skipped (ownership lost): ${job.repoKey}#${job.prNumber} key=${job.eventKey}`,
          );
        }
      } catch (error) {
        const message = errorMessage(error);
        if (job.attempts < this.maxAttempts) {
          const availableAt = delayIso(this.retryDelayMs);
          const scheduled = this.jobStore.retry({
            jobId: job.id,
            workerId: this.workerId,
            error: message,
            availableAt,
          });
          if (scheduled) {
            console.error(
              `[reviewflux] review job retry scheduled: ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          } else {
            console.error(
              `[reviewflux] review job retry skipped (ownership lost): ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          }
        } else {
          const markedFailed = this.jobStore.markFailed({
            jobId: job.id,
            workerId: this.workerId,
            error: message,
          });
          if (markedFailed) {
            console.error(
              `[reviewflux] review job failed: ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          } else {
            console.error(
              `[reviewflux] review job failure skipped (ownership lost): ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          }
        }
      } finally {
        clearInterval(heartbeatTimer);
      }

      processed += 1;
    }

    return processed;
  }
}
