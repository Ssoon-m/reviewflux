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
};

export class ReviewJobWorker {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly staleRunningMs: number;

  constructor(
    private readonly jobStore: ReviewJobStore,
    options: ReviewJobWorkerOptions = {},
  ) {
    this.maxAttempts = Math.max(options.maxAttempts ?? 1, 1);
    this.retryDelayMs = Math.max(options.retryDelayMs ?? 30_000, 1_000);
    this.staleRunningMs = Math.max(options.staleRunningMs ?? 5 * 60_000, 5_000);
  }

  recoverStaleRunningJobs(): number {
    return this.jobStore.recoverStaleRunningJobs(
      new Date(Date.now() - this.staleRunningMs).toISOString(),
    );
  }

  async drain(): Promise<number> {
    let processed = 0;

    while (true) {
      const job = this.jobStore.claimNextRunnableJob();
      if (!job) break;

      console.log(
        `[reviewflux] review job started: ${job.repoKey}#${job.prNumber} key=${job.eventKey} attempt=${job.attempts}`,
      );

      try {
        await runQueuedReviewJob(job.payload);
        this.jobStore.markDone(job.id);
        console.log(
          `[reviewflux] review job completed: ${job.repoKey}#${job.prNumber} key=${job.eventKey}`,
        );
      } catch (error) {
        const message = errorMessage(error);
        if (job.attempts < this.maxAttempts) {
          const availableAt = delayIso(this.retryDelayMs);
          this.jobStore.retry(job.id, { error: message, availableAt });
          console.error(
            `[reviewflux] review job retry scheduled: ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
          );
        } else {
          this.jobStore.markFailed(job.id, message);
          console.error(
            `[reviewflux] review job failed: ${job.repoKey}#${job.prNumber} key=${job.eventKey} error=${message}`,
          );
        }
      }

      processed += 1;
    }

    return processed;
  }
}

