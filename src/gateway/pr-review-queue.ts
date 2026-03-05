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
};

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
    console.error(error instanceof Error ? error.message : String(error));
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
};

export function createPrReviewQueue(options: CreatePrReviewQueueOptions): PrReviewQueue {
  const queue = new PQueue({ concurrency: options.concurrency });
  const logger: PrReviewQueueLogger = {
    ...defaultLogger,
    ...options.logger,
  };

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
      void queue.add(() => runWithRetry(jobId, payload));
      return jobId;
    },
  };
}
