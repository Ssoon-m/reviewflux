import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQueuedReviewJobMock: vi.fn(),
}));

vi.mock("../src/review/runtime.js", () => ({
  runQueuedReviewJob: mocks.runQueuedReviewJobMock,
}));

import {
  ReviewJobStore,
  ReviewJobWorker,
  ReviewQueueDatabase,
} from "../src/review/queue/index.js";

type WorkerLogContext = Record<string, string | number | boolean | undefined>;
type WorkerLogRecord = {
  date: string;
  surface: "queue-worker";
  type: "queue";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  context: WorkerLogContext;
};

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-worker-"));
}

function getWorkerLogPath(home: string, date: string): string {
  return join(home, ".reviewflux", "logs", date, "queue-worker.jsonl");
}

function readWorkerLogs(home: string, date: string): {
  raw: string;
  records: WorkerLogRecord[];
} {
  const raw = readFileSync(getWorkerLogPath(home, date), "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  return {
    raw,
    records: lines.map((line) => JSON.parse(line) as WorkerLogRecord),
  };
}

function enqueueWorkerJob(
  jobStore: ReviewJobStore,
  input: {
    eventKey: string;
    prNumber: number;
    availableAt?: string;
  },
): boolean {
  return jobStore.enqueue({
    repoKey: "ssoon-m/reviewflux",
    prNumber: input.prNumber,
    reason: "manual_force",
    eventName: "issue_comment",
    eventKey: input.eventKey,
    availableAt: input.availableAt ?? "2026-03-12T00:00:00.000Z",
    payload: {
      repo: "ssoon-m/reviewflux",
      prNumber: input.prNumber,
      reason: "manual_force",
      manualTrigger: {
        eventName: "issue_comment",
        commentId: input.eventKey,
      },
    },
  });
}

function takeRunningJobOwnership(
  database: ReviewQueueDatabase,
  eventKey: string,
  workerId: string,
): void {
  database.connection
    .prepare(`UPDATE review_jobs SET worker_id = ?, updated_at = ? WHERE event_key = ?`)
    .run(workerId, new Date().toISOString(), eventKey);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createErrorWithMetadata(input: {
  message: string;
  code: string;
  name: string;
}): Error & { code: string } {
  const error = new Error(input.message) as Error & { code: string };
  error.code = input.code;
  error.name = input.name;
  return error;
}

const homes: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

beforeEach(() => {
  mocks.runQueuedReviewJobMock.mockReset();
  vi.useRealTimers();
});

describe("review job worker", () => {
  it("persists job state transition logs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:01.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;
    const database = new ReviewQueueDatabase({ home });

    try {
      const jobStore = new ReviewJobStore(database);
      const worker = new ReviewJobWorker(jobStore, {
        workerId: "worker-a",
        maxAttempts: 2,
        retryDelayMs: 1_000,
      });
      const sensitiveFailureMessage = "queue exploded SECRET_PROVIDER_RESPONSE";
      const sensitiveFailureToken = "sk-live-worker-secret-token";

      expect(
        enqueueWorkerJob(jobStore, {
          prNumber: 13,
          eventKey: "issue_comment:worker-success",
        }),
      ).toBe(true);
      expect(
        enqueueWorkerJob(jobStore, {
          prNumber: 14,
          eventKey: "issue_comment:worker-failure",
        }),
      ).toBe(true);

      mocks.runQueuedReviewJobMock.mockImplementation(async (payload) => {
        if (payload.prNumber === 14) {
          throw new Error(`${sensitiveFailureMessage} ${sensitiveFailureToken}`);
        }
      });

      expect(await worker.drain()).toBe(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await worker.drain()).toBe(1);

      const { raw, records } = readWorkerLogs(home, "2026-03-12");
      expect(raw.endsWith("\n")).toBe(true);
      expect(raw).not.toContain("\"reason\"");
      expect(raw).not.toContain("manualTrigger");
      expect(raw).not.toContain(sensitiveFailureMessage);
      expect(raw).not.toContain(sensitiveFailureToken);
      expect(
        records.map((record) => ({
          event: record.event,
          level: record.level,
          context: record.context,
        })),
      ).toEqual([
        {
          event: "job_started",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 13,
            eventKey: "issue_comment:worker-success",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_completed",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 13,
            eventKey: "issue_comment:worker-success",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_started",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 14,
            eventKey: "issue_comment:worker-failure",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_retry_scheduled",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 14,
            eventKey: "issue_comment:worker-failure",
            attempt: 1,
            workerId: "worker-a",
            errorMessage: "job_retry_scheduled_error",
          },
        },
        {
          event: "job_started",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 14,
            eventKey: "issue_comment:worker-failure",
            attempt: 2,
            workerId: "worker-a",
          },
        },
        {
          event: "job_failed",
          level: "error",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 14,
            eventKey: "issue_comment:worker-failure",
            attempt: 2,
            workerId: "worker-a",
            errorMessage: "job_failed_error",
          },
        },
      ]);
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });

  it("persists ownership loss transition logs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:01.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;
    const database = new ReviewQueueDatabase({ home });

    try {
      const jobStore = new ReviewJobStore(database);
      const retryingWorker = new ReviewJobWorker(jobStore, {
        workerId: "worker-a",
        maxAttempts: 2,
        staleRunningMs: 5_000,
        heartbeatIntervalMs: 1_000,
      });
      const failingWorker = new ReviewJobWorker(jobStore, {
        workerId: "worker-c",
        maxAttempts: 1,
        staleRunningMs: 5_000,
        heartbeatIntervalMs: 1_000,
      });
      const sensitiveRetryMessage = "retry ownership lost SECRET_RETRY_BODY";
      const sensitiveFailureMessage = "failure ownership lost SECRET_FAILURE_BODY";
      const sensitiveRetryToken = "ghp_retry_worker_secret_token";
      const sensitiveFailureToken = "ghu_failure_worker_secret_token";
      const sensitiveRetryCode = "UPSTREAM_RETRY_CODE_SECRET";
      const sensitiveFailureCode = "UPSTREAM_FAILURE_CODE_SECRET";
      const sensitiveRetryName = "ProviderRetryErrorSecret";
      const sensitiveFailureName = "ProviderFailureErrorSecret";

      expect(
        enqueueWorkerJob(jobStore, {
          prNumber: 15,
          eventKey: "issue_comment:lost-completion",
        }),
      ).toBe(true);
      const completion = createDeferred<void>();
      mocks.runQueuedReviewJobMock.mockImplementationOnce(() => completion.promise);
      const completionDrain = retryingWorker.drain();

      takeRunningJobOwnership(database, "issue_comment:lost-completion", "worker-b");
      await vi.advanceTimersByTimeAsync(1_000);
      completion.resolve();
      expect(await completionDrain).toBe(1);

      expect(
        enqueueWorkerJob(jobStore, {
          prNumber: 16,
          eventKey: "issue_comment:lost-retry",
          availableAt: new Date(Date.now()).toISOString(),
        }),
      ).toBe(true);
      const retry = createDeferred<void>();
      mocks.runQueuedReviewJobMock.mockImplementationOnce(() => retry.promise);
      const retryDrain = retryingWorker.drain();

      takeRunningJobOwnership(database, "issue_comment:lost-retry", "worker-b");
      await vi.advanceTimersByTimeAsync(1_000);
      retry.reject(
        createErrorWithMetadata({
          message: `${sensitiveRetryMessage} ${sensitiveRetryToken}`,
          code: sensitiveRetryCode,
          name: sensitiveRetryName,
        }),
      );
      expect(await retryDrain).toBe(1);

      expect(
        enqueueWorkerJob(jobStore, {
          prNumber: 17,
          eventKey: "issue_comment:lost-failure",
          availableAt: new Date(Date.now()).toISOString(),
        }),
      ).toBe(true);
      const failure = createDeferred<void>();
      mocks.runQueuedReviewJobMock.mockImplementationOnce(() => failure.promise);
      const failureDrain = failingWorker.drain();

      takeRunningJobOwnership(database, "issue_comment:lost-failure", "worker-d");
      await vi.advanceTimersByTimeAsync(1_000);
      failure.reject(
        createErrorWithMetadata({
          message: `${sensitiveFailureMessage} ${sensitiveFailureToken}`,
          code: sensitiveFailureCode,
          name: sensitiveFailureName,
        }),
      );
      expect(await failureDrain).toBe(1);

      const { raw, records } = readWorkerLogs(home, "2026-03-12");
      expect(raw).not.toContain(sensitiveRetryMessage);
      expect(raw).not.toContain(sensitiveFailureMessage);
      expect(raw).not.toContain(sensitiveRetryToken);
      expect(raw).not.toContain(sensitiveFailureToken);
      expect(raw).not.toContain(sensitiveRetryCode);
      expect(raw).not.toContain(sensitiveFailureCode);
      expect(raw).not.toContain(sensitiveRetryName);
      expect(raw).not.toContain(sensitiveFailureName);
      expect(
        records.map((record) => ({
          event: record.event,
          level: record.level,
          context: record.context,
        })),
      ).toEqual([
        {
          event: "job_started",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 15,
            eventKey: "issue_comment:lost-completion",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_heartbeat_lost_ownership",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 15,
            eventKey: "issue_comment:lost-completion",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_completion_skipped_ownership_lost",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 15,
            eventKey: "issue_comment:lost-completion",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_started",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 16,
            eventKey: "issue_comment:lost-retry",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_heartbeat_lost_ownership",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 16,
            eventKey: "issue_comment:lost-retry",
            attempt: 1,
            workerId: "worker-a",
          },
        },
        {
          event: "job_retry_skipped_ownership_lost",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 16,
            eventKey: "issue_comment:lost-retry",
            attempt: 1,
            workerId: "worker-a",
            errorMessage: "job_retry_skipped_ownership_lost_error",
          },
        },
        {
          event: "job_started",
          level: "info",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 17,
            eventKey: "issue_comment:lost-failure",
            attempt: 1,
            workerId: "worker-c",
          },
        },
        {
          event: "job_heartbeat_lost_ownership",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 17,
            eventKey: "issue_comment:lost-failure",
            attempt: 1,
            workerId: "worker-c",
          },
        },
        {
          event: "job_failure_skipped_ownership_lost",
          level: "warn",
          context: {
            repo: "ssoon-m/reviewflux",
            prNumber: 17,
            eventKey: "issue_comment:lost-failure",
            attempt: 1,
            workerId: "worker-c",
            errorMessage: "job_failure_skipped_ownership_lost_error",
          },
        },
      ]);
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });

  it("does not log heartbeat refresh ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:01.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;
    const database = new ReviewQueueDatabase({ home });

    try {
      const jobStore = new ReviewJobStore(database);
      const worker = new ReviewJobWorker(jobStore, {
        workerId: "worker-a",
        staleRunningMs: 5_000,
        heartbeatIntervalMs: 1_000,
      });

      expect(
        jobStore.enqueue({
          repoKey: "ssoon-m/reviewflux",
          prNumber: 13,
          reason: "manual_force",
          eventName: "issue_comment",
          eventKey: "issue_comment:worker-heartbeat",
          availableAt: "2026-03-12T00:00:00.000Z",
          payload: {
            repo: "ssoon-m/reviewflux",
            prNumber: 13,
            reason: "manual_force",
            manualTrigger: {
              eventName: "issue_comment",
              commentId: "worker-heartbeat",
            },
          },
        }),
      ).toBe(true);

      let resolveJob!: () => void;
      mocks.runQueuedReviewJobMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveJob = resolve;
          }),
      );

      const drainPromise = worker.drain();

      expect(mocks.runQueuedReviewJobMock).toHaveBeenCalledTimes(1);

      let row = database.connection
        .prepare(
          `SELECT status, worker_id, heartbeat_at FROM review_jobs WHERE event_key = ?`,
        )
        .get("issue_comment:worker-heartbeat") as {
        status: string;
        worker_id: string | null;
        heartbeat_at: string | null;
      };
      expect(row).toEqual({
        status: "running",
        worker_id: "worker-a",
        heartbeat_at: "2026-03-12T00:00:01.000Z",
      });

      await vi.advanceTimersByTimeAsync(2_000);

      row = database.connection
        .prepare(
          `SELECT status, worker_id, heartbeat_at FROM review_jobs WHERE event_key = ?`,
        )
        .get("issue_comment:worker-heartbeat") as {
        status: string;
        worker_id: string | null;
        heartbeat_at: string | null;
      };
      expect(row.heartbeat_at).toBe("2026-03-12T00:00:03.000Z");
      expect(readWorkerLogs(home, "2026-03-12").records.map((record) => record.event)).toEqual([
        "job_started",
      ]);

      resolveJob();
      await drainPromise;

      const completedRow = database.connection
        .prepare(
          `SELECT status, worker_id, heartbeat_at, completed_at FROM review_jobs WHERE event_key = ?`,
        )
        .get("issue_comment:worker-heartbeat") as {
        status: string;
        worker_id: string | null;
        heartbeat_at: string | null;
        completed_at: string | null;
      };
      expect(completedRow).toEqual({
        status: "done",
        worker_id: null,
        heartbeat_at: null,
        completed_at: "2026-03-12T00:00:03.000Z",
      });
      expect(readWorkerLogs(home, "2026-03-12").records.map((record) => record.event)).toEqual([
        "job_started",
        "job_completed",
      ]);
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });
});
