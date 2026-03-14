import { mkdtempSync, rmSync } from "node:fs";
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

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-worker-"));
}

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

beforeEach(() => {
  mocks.runQueuedReviewJobMock.mockReset();
  vi.useRealTimers();
});

describe("review job worker", () => {
  it("refreshes heartbeat while a job is running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:01.000Z"));

    const home = makeTempHome();
    homes.push(home);
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
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });
});
