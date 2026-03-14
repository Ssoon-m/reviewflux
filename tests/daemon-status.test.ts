import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemonStatusCommand } from "../src/commands/daemon/status.js";
import {
  ReviewJobStore,
  ReviewQueueDatabase,
  reviewQueuePath,
} from "../src/review/queue/index.js";

type DaemonLogRecord = {
  ts: string;
  date: string;
  surface: "daemon";
  type: "lifecycle" | "queue" | "system";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  context: Record<string, string | number | boolean | undefined>;
};

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-status-"));
}

function getDaemonLogPath(home: string, date: string): string {
  return join(home, ".reviewflux", "logs", `daemon-${date}.jsonl`);
}

function readDaemonLog(home: string, date: string): DaemonLogRecord[] {
  return readFileSync(getDaemonLogPath(home, date), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DaemonLogRecord);
}

const homes: string[] = [];
const originalHome = process.env.HOME;
const originalStaleMs = process.env.REVIEWFLUX_JOB_STALE_RUNNING_MS;

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalStaleMs === undefined) {
    delete process.env.REVIEWFLUX_JOB_STALE_RUNNING_MS;
  } else {
    process.env.REVIEWFLUX_JOB_STALE_RUNNING_MS = originalStaleMs;
  }
  vi.useRealTimers();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("daemon status", () => {
  it("reports queue counts and stale-running jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:10.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;
    process.env.REVIEWFLUX_JOB_STALE_RUNNING_MS = "5000";

    const database = new ReviewQueueDatabase({ home });

    try {
      const jobStore = new ReviewJobStore(database);

      jobStore.enqueue({
        repoKey: "ssoon-m/reviewflux",
        prNumber: 1,
        reason: "on_push",
        eventName: "pull_request",
        eventKey: "pr:on_push:ssoon-m/reviewflux:1:pending",
        availableAt: "2026-03-12T00:00:00.000Z",
        payload: { repo: "ssoon-m/reviewflux", prNumber: 1, reason: "on_push" },
      });
      jobStore.enqueue({
        repoKey: "ssoon-m/reviewflux",
        prNumber: 2,
        reason: "on_push",
        eventName: "pull_request",
        eventKey: "pr:on_push:ssoon-m/reviewflux:2:running",
        availableAt: "2026-03-12T00:00:00.000Z",
        payload: { repo: "ssoon-m/reviewflux", prNumber: 2, reason: "on_push" },
      });
      jobStore.enqueue({
        repoKey: "ssoon-m/reviewflux",
        prNumber: 3,
        reason: "on_push",
        eventName: "pull_request",
        eventKey: "pr:on_push:ssoon-m/reviewflux:3:done",
        availableAt: "2026-03-12T00:00:00.000Z",
        payload: { repo: "ssoon-m/reviewflux", prNumber: 3, reason: "on_push" },
      });
      jobStore.enqueue({
        repoKey: "ssoon-m/reviewflux",
        prNumber: 4,
        reason: "on_push",
        eventName: "pull_request",
        eventKey: "pr:on_push:ssoon-m/reviewflux:4:failed",
        availableAt: "2026-03-12T00:00:00.000Z",
        payload: { repo: "ssoon-m/reviewflux", prNumber: 4, reason: "on_push" },
      });

      const runningJob = jobStore.claimNextRunnableJob({
        workerId: "worker-a",
        now: "2026-03-12T00:00:01.000Z",
      });
      const doneJob = jobStore.claimNextRunnableJob({
        workerId: "worker-a",
        now: "2026-03-12T00:00:02.000Z",
      });
      const failedJob = jobStore.claimNextRunnableJob({
        workerId: "worker-a",
        now: "2026-03-12T00:00:03.000Z",
      });

      expect(runningJob).not.toBeNull();
      expect(doneJob).not.toBeNull();
      expect(failedJob).not.toBeNull();

      if (!doneJob || !failedJob) {
        throw new Error("expected claimed jobs for done and failed cases");
      }

      expect(
        jobStore.markDone({
          jobId: doneJob.id,
          workerId: "worker-a",
          completedAt: "2026-03-12T00:00:04.000Z",
        }),
      ).toBe(true);
      expect(
        jobStore.markFailed({
          jobId: failedJob.id,
          workerId: "worker-a",
          error: "boom",
          failedAt: "2026-03-12T00:00:05.000Z",
        }),
      ).toBe(true);

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        await runDaemonStatusCommand();

        expect(logSpy.mock.calls.map(([message]) => message)).toEqual([
          "[reviewflux] daemon status",
          `[reviewflux] queue database: ${reviewQueuePath(home)}`,
          "[reviewflux] jobs pending=1 running=1 done=1 failed=1",
          "[reviewflux] stale running (>5000ms): 1",
          "[reviewflux] oldest pending available_at: 2026-03-12T00:00:00.000Z",
          "[reviewflux] oldest running claimed_at: 2026-03-12T00:00:01.000Z",
        ]);
        expect(readDaemonLog(home, "2026-03-12")).toEqual([
          {
            ts: "2026-03-12T00:00:10.000Z",
            date: "2026-03-12",
            surface: "daemon",
            type: "queue",
            level: "info",
            event: "daemon_status_snapshot",
            message: "Daemon status snapshot",
            context: {
              pending: 1,
              running: 1,
              done: 1,
              failed: 1,
              staleRunningCount: 1,
            },
          },
        ]);
      } finally {
        logSpy.mockRestore();
      }
    } finally {
      database.close();
    }
  });
});
