import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReviewJobStore,
  ReviewPollStateStore,
  ReviewQueueDatabase,
  reviewQueuePath,
} from "../src/review/queue/index.js";
import { REVIEW_QUEUE_SCHEMA_VERSION } from "../src/review/queue/schema.js";
import { loadReviewState, saveReviewState } from "../src/review/state-store.js";

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

      expect(journalMode.toLowerCase()).toBe("wal");
      expect(foreignKeys).toBe(1);
      expect(synchronousMode).toBe(1);
      expect(busyTimeout).toBe(5000);
      expect(schemaVersion?.value).toBe(String(REVIEW_QUEUE_SCHEMA_VERSION));
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
        prHeads: { "13": "headsha" },
      });

      expect(pollStateStore.loadProject("ssoon-m/reviewflux")).toEqual({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 10,
        lastSeenReviewCommentId: 20,
        prHeads: { "13": "headsha" },
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

      const claimed = jobStore.claimNextRunnableJob("2026-03-12T00:00:01.000Z");
      expect(claimed).toMatchObject({
        repoKey: "ssoon-m/reviewflux",
        prNumber: 13,
        status: "running",
        attempts: 1,
      });

      expect(jobStore.claimNextRunnableJob("2026-03-12T00:00:02.000Z")).toBeNull();

      jobStore.markDone(claimed!.id, "2026-03-12T00:00:03.000Z");
      expect(jobStore.claimNextRunnableJob("2026-03-12T00:00:04.000Z")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("requeues stale running jobs for a later retry", () => {
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

      const firstAttempt = jobStore.claimNextRunnableJob("2026-03-12T00:00:01.000Z");
      expect(firstAttempt?.attempts).toBe(1);

      expect(
        jobStore.recoverStaleRunningJobs(
          "2026-03-12T00:00:02.000Z",
          "2026-03-12T00:00:03.000Z",
        ),
      ).toBe(1);

      const retried = jobStore.claimNextRunnableJob("2026-03-12T00:00:04.000Z");
      expect(retried).toMatchObject({
        eventKey: "issue_comment:123",
        status: "running",
        attempts: 2,
      });
    } finally {
      database.close();
    }
  });
});
