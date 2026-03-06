import PQueue from "p-queue";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import type { PrEventDecision, PrEventInput } from "./pr-event-policy.js";

export type PrReviewJobPayload = PrEventInput & {
  prNumber: number;
  reason: Extract<PrEventDecision["reason"], "manual_force" | "opened_once" | "on_push">;
  force: boolean;
};

type PrReviewQueueLogger = {
  enqueue: (jobId: string, payload: PrReviewJobPayload) => void;
  start: (jobId: string, attempt: number, payload: PrReviewJobPayload) => void;
  success: (jobId: string, payload: PrReviewJobPayload) => void;
  fail: (
    jobId: string,
    attempt: number,
    error: unknown,
    payload: PrReviewJobPayload,
  ) => void;
  terminalFailure: (
    jobId: string,
    attempt: number,
    error: unknown,
    payload: PrReviewJobPayload,
  ) => void;
};

export type PrReviewJobFailure = {
  jobId: string;
  attempt: number;
  errorMessage: string;
  payload: PrReviewJobPayload;
  failedAtEpochMs: number;
};

const MAX_RECENT_FAILURES = 100;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultLogger: PrReviewQueueLogger = {
  enqueue: (jobId, payload) => {
    console.log(`[reviewflux] queue enqueue id=${jobId} repo=${payload.repo}`);
  },
  start: (jobId, attempt, payload) => {
    console.log(
      `[reviewflux] queue start id=${jobId} attempt=${attempt} repo=${payload.repo}`,
    );
  },
  success: (jobId, payload) => {
    console.log(`[reviewflux] queue success id=${jobId} repo=${payload.repo}`);
  },
  fail: (jobId, attempt, error, payload) => {
    console.error(
      `[reviewflux] queue fail id=${jobId} attempt=${attempt} repo=${payload.repo}`,
    );
    console.error(toErrorMessage(error));
  },
  terminalFailure: (jobId, attempt, error, payload) => {
    console.error(
      `[reviewflux] queue terminal-fail id=${jobId} attempt=${attempt} repo=${payload.repo}`,
    );
    console.error(toErrorMessage(error));
  },
};

export type CreatePrReviewQueueOptions = {
  concurrency: number;
  retryCount: number;
  retryDelayMs: number;
  processJob: (payload: PrReviewJobPayload) => Promise<void>;
  logger?: Partial<PrReviewQueueLogger>;
};

export type PrReviewQueue = {
  enqueue: (payload: PrReviewJobPayload) => string;
  getRecentFailures: () => PrReviewJobFailure[];
};

export function createPrReviewQueue(options: CreatePrReviewQueueOptions): PrReviewQueue {
  const queue = new PQueue({ concurrency: options.concurrency });
  const recentFailures: PrReviewJobFailure[] = [];
  const logger: PrReviewQueueLogger = {
    ...defaultLogger,
    ...options.logger,
  };

  function recordFailure(entry: PrReviewJobFailure): void {
    recentFailures.push(entry);
    if (recentFailures.length > MAX_RECENT_FAILURES) {
      recentFailures.splice(0, recentFailures.length - MAX_RECENT_FAILURES);
    }
  }

  async function runWithRetry(jobId: string, payload: PrReviewJobPayload): Promise<void> {
    for (let attempt = 1; attempt <= options.retryCount + 1; attempt += 1) {
      try {
        logger.start(jobId, attempt, payload);
        await options.processJob(payload);
        logger.success(jobId, payload);
        return;
      } catch (error) {
        logger.fail(jobId, attempt, error, payload);
        if (attempt > options.retryCount) {
          logger.terminalFailure(jobId, attempt, error, payload);
          recordFailure({
            jobId,
            attempt,
            errorMessage: toErrorMessage(error),
            payload,
            failedAtEpochMs: Date.now(),
          });
          return;
        }
        await wait(options.retryDelayMs);
      }
    }
  }

  return {
    enqueue(payload) {
      const jobId = randomUUID();
      logger.enqueue(jobId, payload);
      void queue.add(() => runWithRetry(jobId, payload)).catch((error) => {
        logger.terminalFailure(jobId, 0, error, payload);
        recordFailure({
          jobId,
          attempt: 0,
          errorMessage: toErrorMessage(error),
          payload,
          failedAtEpochMs: Date.now(),
        });
      });
      return jobId;
    },
    getRecentFailures() {
      return [...recentFailures];
    },
  };
}
