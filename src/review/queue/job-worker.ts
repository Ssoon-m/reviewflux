import { randomUUID } from "node:crypto";
import { logging } from "../../infra/logging/index.js";
import { runQueuedReviewJob } from "../runtime.js";
import type { ReviewJobStore } from "./job-store.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactedErrorMessage(event: string): string {
  switch (event) {
    case "job_retry_scheduled":
      return "job_retry_scheduled_error";
    case "job_retry_skipped_ownership_lost":
      return "job_retry_skipped_ownership_lost_error";
    case "job_failed":
      return "job_failed_error";
    case "job_failure_skipped_ownership_lost":
      return "job_failure_skipped_ownership_lost_error";
    default:
      return "review_job_error";
  }
}

function delayIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function logJobTransition(input: {
  job: {
    repoKey: string;
    prNumber: number;
    eventKey: string;
    attempts: number;
  };
  workerId: string;
  event: string;
  level: "info" | "warn" | "error";
  message: string;
  errorMessage?: string;
}): void {
  logging({
    surface: "queue-worker",
    type: "queue",
    level: input.level,
    event: input.event,
    message: input.message,
    context: {
      repo: input.job.repoKey,
      prNumber: input.job.prNumber,
      eventKey: input.job.eventKey,
      attempt: input.job.attempts,
      workerId: input.workerId,
      errorMessage: input.errorMessage,
    },
  });
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

  async drain(options: { signal?: AbortSignal } = {}): Promise<number> {
    let processed = 0;

    while (true) {
      if (options.signal?.aborted) {
        break;
      }

      const job = this.jobStore.claimNextRunnableJob({ workerId: this.workerId });
      if (!job) break;

      logJobTransition({
        job,
        workerId: this.workerId,
        event: "job_started",
        level: "info",
        message: "Review job started",
      });
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
          logJobTransition({
            job,
            workerId: this.workerId,
            event: "job_heartbeat_lost_ownership",
            level: "warn",
            message: "Review job heartbeat lost ownership",
          });
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
          logJobTransition({
            job,
            workerId: this.workerId,
            event: "job_completed",
            level: "info",
            message: "Review job completed",
          });
          console.log(
            `[reviewflux] review job completed: ${job.repoKey}#${job.prNumber} key=${job.eventKey}`,
          );
        } else {
          logJobTransition({
            job,
            workerId: this.workerId,
            event: "job_completion_skipped_ownership_lost",
            level: "warn",
            message: "Review job completion skipped after ownership lost",
          });
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
            logJobTransition({
              job,
              workerId: this.workerId,
              event: "job_retry_scheduled",
              level: "warn",
              message: "Review job retry scheduled",
              errorMessage: redactedErrorMessage("job_retry_scheduled"),
            });
            console.error(
              `[reviewflux] review job retry scheduled: ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          } else {
            logJobTransition({
              job,
              workerId: this.workerId,
              event: "job_retry_skipped_ownership_lost",
              level: "warn",
              message: "Review job retry skipped after ownership lost",
              errorMessage: redactedErrorMessage("job_retry_skipped_ownership_lost"),
            });
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
            logJobTransition({
              job,
              workerId: this.workerId,
              event: "job_failed",
              level: "error",
              message: "Review job failed",
              errorMessage: redactedErrorMessage("job_failed"),
            });
            console.error(
              `[reviewflux] review job failed: ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          } else {
            logJobTransition({
              job,
              workerId: this.workerId,
              event: "job_failure_skipped_ownership_lost",
              level: "warn",
              message: "Review job failure skipped after ownership lost",
              errorMessage: redactedErrorMessage("job_failure_skipped_ownership_lost"),
            });
            console.error(
              `[reviewflux] review job failure skipped (ownership lost): ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
            );
          }
        }
      } finally {
        clearInterval(heartbeatTimer);
      }

      processed += 1;

      if (options.signal?.aborted) {
        break;
      }
    }

    return processed;
  }
}
