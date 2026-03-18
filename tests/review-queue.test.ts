import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReviewJobStore,
  ReviewPollStateStore,
  ReviewQueueDatabase,
  reviewQueuePath,
} from "../src/review/queue/index";
import { REVIEW_QUEUE_SCHEMA_VERSION } from "../src/review/queue/schema";
import { loadReviewState, saveReviewState } from "../src/review/state-store";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-queue-"));
}

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("review queue storage", () => {
  it("builds the queue database path from the raw user home once", () => {
    const home = makeTempHome();
    homes.push(home);

    expect(reviewQueuePath(home)).toBe(join(home, ".reviewflux", "reviewflux.db"));
    expect(reviewQueuePath(home)).not.toContain(join(".reviewflux", ".reviewflux"));
  });

  it("applies sqlite settings and bootstraps schema metadata", () => {
    const home = makeTempHome();
    homes.push(home);
    const database = new ReviewQueueDatabase({ home });

    try {
      const journalMode = database.connection.pragma("journal_mode", {
        simple: true,
      }) as string;
      const foreignKeys = database.connection.pragma("foreign_keys", {
        simple: true,
      }) as number;
      const synchronousMode = database.connection.pragma("synchronous", {
        simple: true,
      }) as number;
      const busyTimeout = database.connection.pragma("busy_timeout", {
        simple: true,
      }) as number;
      const schemaVersion = database.connection
        .prepare(`SELECT value FROM review_queue_meta WHERE key = ?`)
        .get("schema_version") as { value: string } | undefined;
      const reviewJobColumns = database.connection
        .prepare(`PRAGMA table_info(review_jobs)`)
        .all() as Array<{ name: string }>;
      const pollStateColumns = database.connection
        .prepare(`PRAGMA table_info(project_poll_state)`)
        .all() as Array<{ name: string }>;
      const prStateColumns = database.connection
        .prepare(`PRAGMA table_info(project_pr_heads)`)
        .all() as Array<{ name: string }>;

      expect(journalMode.toLowerCase()).toBe("wal");
      expect(foreignKeys).toBe(1);
      expect(synchronousMode).toBe(1);
      expect(busyTimeout).toBe(5000);
      expect(schemaVersion?.value).toBe(String(REVIEW_QUEUE_SCHEMA_VERSION));
      expect(reviewJobColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["worker_id", "heartbeat_at"]),
      );
      expect(pollStateColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "last_manual_backstop_at",
          "next_manual_backstop_at",
        ]),
      );
      expect(prStateColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "last_seen_updated_at",
          "last_seen_issue_comment_id",
          "last_seen_review_comment_id",
          "last_targeted_refresh_at",
          "next_targeted_refresh_at",
        ]),
      );
    } finally {
      database.close();
    }
  });

  it("migrates legacy review_jobs rows to include worker ownership columns", () => {
    const home = makeTempHome();
    homes.push(home);
    const path = reviewQueuePath(home);
    mkdirSync(dirname(path), { recursive: true });
    const legacyDatabase = new BetterSqlite3(path);

    try {
      legacyDatabase.exec(`
        CREATE TABLE review_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo_key TEXT NOT NULL,
          pr_number INTEGER NOT NULL,
          reason TEXT NOT NULL,
          event_name TEXT NOT NULL,
          event_key TEXT NOT NULL UNIQUE,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          available_at TEXT NOT NULL,
          claimed_at TEXT,
          completed_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    } finally {
      legacyDatabase.close();
    }

    const database = new ReviewQueueDatabase({ home });

    try {
      const reviewJobColumns = database.connection
        .prepare(`PRAGMA table_info(review_jobs)`)
        .all() as Array<{ name: string }>;

      expect(reviewJobColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["worker_id", "heartbeat_at"]),
      );
    } finally {
      database.close();
    }
  });

  it("persists runtime review state in sqlite", () => {
    const home = makeTempHome();
    homes.push(home);

    saveReviewState(
      {
        projects: {
          "ssoon-m/reviewflux": {
            initialized: true,
            prHeads: { "13": "abc123" },
            seenForceCommentIds: ["issue:1"],
            postedReviewKeys: ["13:abc123:on_push"],
            handledManualTriggerKeys: ["issue_comment:99"],
          },
        },
      },
      home,
    );

    expect(existsSync(reviewQueuePath(home))).toBe(true);
    expect(loadReviewState(home)).toEqual({
      projects: {
        "ssoon-m/reviewflux": {
          initialized: true,
          prHeads: { "13": "abc123" },
          seenForceCommentIds: ["issue:1"],
          postedReviewKeys: ["13:abc123:on_push"],
          handledManualTriggerKeys: ["issue_comment:99"],
        },
      },
    });
  });

  it("tracks poll snapshots and claims queued jobs once", () => {
    const home = makeTempHome();
    homes.push(home);
    const database = new ReviewQueueDatabase({ home });

    try {
      const pollStateStore = new ReviewPollStateStore(database);
      const jobStore = new ReviewJobStore(database);

      pollStateStore.saveProject({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 10,
        lastSeenReviewCommentId: 20,
        lastManualBackstopAt: "2026-03-12T00:00:00.000Z",
        nextManualBackstopAt: "2026-03-12T00:10:00.000Z",
        prStates: {
          "13": {
            headSha: "headsha",
            lastSeenUpdatedAt: "2026-03-11T23:59:00.000Z",
            lastSeenIssueCommentId: 8,
            lastSeenReviewCommentId: 18,
            lastTargetedRefreshAt: "2026-03-12T00:00:00.000Z",
            nextTargetedRefreshAt: "2026-03-12T00:00:30.000Z",
          },
        },
      });

      expect(pollStateStore.loadProject("ssoon-m/reviewflux")).toEqual({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 10,
        lastSeenReviewCommentId: 20,
        lastManualBackstopAt: "2026-03-12T00:00:00.000Z",
        nextManualBackstopAt: "2026-03-12T00:10:00.000Z",
        prStates: {
          "13": {
            headSha: "headsha",
            lastSeenUpdatedAt: "2026-03-11T23:59:00.000Z",
            lastSeenIssueCommentId: 8,
            lastSeenReviewCommentId: 18,
            lastTargetedRefreshAt: "2026-03-12T00:00:00.000Z",
            nextTargetedRefreshAt: "2026-03-12T00:00:30.000Z",
          },
        },
      });

      const availableAt = "2026-03-12T00:00:00.000Z";
      expect(
        jobStore.enqueue({
          repoKey: "ssoon-m/reviewflux",
          prNumber: 13,
          reason: "on_push",
          eventName: "pull_request",
          eventKey: "pr:on_push:ssoon-m/reviewflux:13:headsha",
          availableAt,
          payload: {
            repo: "ssoon-m/reviewflux",
            prNumber: 13,
            reason: "on_push",
          },
        }),
      ).toBe(true);
      expect(
        jobStore.enqueue({
          repoKey: "ssoon-m/reviewflux",
          prNumber: 13,
          reason: "on_push",
          eventName: "pull_request",
          eventKey: "pr:on_push:ssoon-m/reviewflux:13:headsha",
          availableAt,
          payload: {
            repo: "ssoon-m/reviewflux",
            prNumber: 13,
            reason: "on_push",
          },
        }),
      ).toBe(false);

       const claimed = jobStore.claimNextRunnableJob({
         workerId: "worker-a",
         now: "2026-03-12T00:00:01.000Z",
       });
        expect(claimed).toMatchObject({
          repoKey: "ssoon-m/reviewflux",
          prNumber: 13,
         status: "running",
         attempts: 1,
          workerId: "worker-a",
          heartbeatAt: "2026-03-12T00:00:01.000Z",
        });
        if (!claimed) {
          throw new Error("expected_claimed_job");
        }

        expect(
          jobStore.claimNextRunnableJob({
           workerId: "worker-b",
           now: "2026-03-12T00:00:02.000Z",
         }),
       ).toBeNull();

        expect(
          jobStore.markDone({
            jobId: claimed.id,
            workerId: "worker-a",
            completedAt: "2026-03-12T00:00:03.000Z",
          }),
       ).toBe(true);
       expect(
         jobStore.claimNextRunnableJob({
           workerId: "worker-a",
           now: "2026-03-12T00:00:04.000Z",
         }),
       ).toBeNull();
     } finally {
       database.close();
     }
   });

  it("uses heartbeat freshness and worker ownership when recovering stale jobs", () => {
    const home = makeTempHome();
    homes.push(home);
    const database = new ReviewQueueDatabase({ home });

    try {
      const jobStore = new ReviewJobStore(database);
      expect(
        jobStore.enqueue({
          repoKey: "ssoon-m/reviewflux",
          prNumber: 13,
          reason: "manual_force",
          eventName: "issue_comment",
          eventKey: "issue_comment:123",
          availableAt: "2026-03-12T00:00:00.000Z",
          payload: {
            repo: "ssoon-m/reviewflux",
            prNumber: 13,
            reason: "manual_force",
            manualTrigger: {
              eventName: "issue_comment",
              commentId: "123",
            },
          },
        }),
      ).toBe(true);

      const firstAttempt = jobStore.claimNextRunnableJob({
        workerId: "worker-a",
        now: "2026-03-12T00:00:01.000Z",
      });
      expect(firstAttempt).toMatchObject({
        attempts: 1,
        workerId: "worker-a",
        heartbeatAt: "2026-03-12T00:00:01.000Z",
      });
      if (!firstAttempt) {
        throw new Error("expected_first_attempt");
      }

      expect(
        jobStore.markDone({
          jobId: firstAttempt.id,
          workerId: "worker-b",
          completedAt: "2026-03-12T00:00:02.000Z",
        }),
      ).toBe(false);

      expect(
        jobStore.refreshRunningJobHeartbeat({
          jobId: firstAttempt.id,
          workerId: "worker-a",
          heartbeatAt: "2026-03-12T00:00:03.000Z",
        }),
      ).toBe(true);

      expect(
        jobStore.recoverStaleRunningJobs(
          "2026-03-12T00:00:02.000Z",
          "2026-03-12T00:00:04.000Z",
        ),
      ).toBe(0);

      expect(
        jobStore.recoverStaleRunningJobs(
          "2026-03-12T00:00:04.000Z",
          "2026-03-12T00:00:05.000Z",
        ),
      ).toBe(1);

      const retried = jobStore.claimNextRunnableJob({
        workerId: "worker-b",
        now: "2026-03-12T00:00:06.000Z",
      });
      expect(retried).toMatchObject({
        eventKey: "issue_comment:123",
        status: "running",
        attempts: 2,
        workerId: "worker-b",
        heartbeatAt: "2026-03-12T00:00:06.000Z",
      });
    } finally {
      database.close();
    }
  });
});
