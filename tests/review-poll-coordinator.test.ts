import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IssueComment,
  IssueInfo,
  ProjectConfig,
  PullRequestSummary,
  PullReviewComment,
} from "../src/review/types";

const mocks = vi.hoisted(() => ({
  fetchIssueInfoMock: vi.fn(),
  ghApiPaginatedJsonMock: vi.fn(),
  listOpenPullRequestsMock: vi.fn(),
  listPullRequestIssueCommentsMock: vi.fn(),
  listPullRequestReviewCommentsMock: vi.fn(),
  loggingMock: vi.fn(),
}));

vi.mock("../src/review/github.js", () => ({
  fetchIssueInfo: mocks.fetchIssueInfoMock,
  ghApiPaginatedJson: mocks.ghApiPaginatedJsonMock,
  listOpenPullRequests: mocks.listOpenPullRequestsMock,
  listPullRequestIssueComments: mocks.listPullRequestIssueCommentsMock,
  listPullRequestReviewComments: mocks.listPullRequestReviewCommentsMock,
  parseOwnerRepo: (repo: string) => {
    const [owner, name] = repo.split("/");
    return { owner: owner ?? "", name: name ?? "" };
  },
}));

vi.mock("../src/infra/logging/index.js", () => ({
  logging: mocks.loggingMock,
}));

import {
  ReviewJobStore,
  ReviewPollCoordinator,
  ReviewPollStateStore,
  ReviewQueueDatabase,
} from "../src/review/queue/index";

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-poll-"));
}

function makeProject(): ProjectConfig {
  return {
    repo: "ssoon-m/reviewflux",
    pr: {
      mode: "on_push",
      forceCommand: "@reviewflux",
    },
    context: {
      mode: "default",
    },
  };
}

function makePullRequestSummary(params: {
  number: number;
  headSha: string;
  updatedAt: string;
}): PullRequestSummary {
  return {
    number: params.number,
    title: `PR ${params.number}`,
    updated_at: params.updatedAt,
    head: { sha: params.headSha },
  };
}

function mockRepoWideComments(params: {
  issueComments?: IssueComment[];
  reviewComments?: PullReviewComment[];
}): void {
  mocks.ghApiPaginatedJsonMock.mockImplementation(async (path: string) => {
    if (path.endsWith("/issues/comments")) {
      return params.issueComments ?? [];
    }

    if (path.endsWith("/pulls/comments")) {
      return params.reviewComments ?? [];
    }

    throw new Error(`unexpected_paginated_path:${path}`);
  });
}

function mockPullRequestComments(params: {
  issueCommentsByPr?: Record<number, IssueComment[]>;
  reviewCommentsByPr?: Record<number, PullReviewComment[]>;
}): void {
  mocks.listPullRequestIssueCommentsMock.mockImplementation(
    async (_repo: string, prNumber: number) => {
      return params.issueCommentsByPr?.[prNumber] ?? [];
    },
  );
  mocks.listPullRequestReviewCommentsMock.mockImplementation(
    async (_repo: string, prNumber: number) => {
      return params.reviewCommentsByPr?.[prNumber] ?? [];
    },
  );
}

const homes: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));
  mocks.fetchIssueInfoMock.mockReset();
  mocks.ghApiPaginatedJsonMock.mockReset();
  mocks.listOpenPullRequestsMock.mockReset();
  mocks.listPullRequestIssueCommentsMock.mockReset();
  mocks.listPullRequestReviewCommentsMock.mockReset();
  mocks.loggingMock.mockReset();
});

describe("review poll coordinator", () => {
  it("logs baseline priming without backfilling jobs", async () => {
    const home = makeTempHome();
    homes.push(home);
    const database = new ReviewQueueDatabase({ home });

    try {
      const pollStateStore = new ReviewPollStateStore(database);
      const jobStore = new ReviewJobStore(database);
      const coordinator = new ReviewPollCoordinator(pollStateStore, jobStore);

      mocks.listOpenPullRequestsMock.mockResolvedValue([
        makePullRequestSummary({
          number: 7,
          headSha: "headsha",
          updatedAt: "2026-03-14T08:59:00.000Z",
        }),
      ] satisfies PullRequestSummary[]);
      mockRepoWideComments({
        issueComments: [
          {
            id: 11,
            issue_url: "https://api.github.com/repos/ssoon-m/reviewflux/issues/7",
          },
        ],
        reviewComments: [
          {
            id: 22,
            pull_request_url:
              "https://api.github.com/repos/ssoon-m/reviewflux/pulls/7",
          },
        ],
      });

      await coordinator.pollProject(makeProject());

      expect(pollStateStore.loadProject("ssoon-m/reviewflux")).toEqual({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 11,
        lastSeenReviewCommentId: 22,
        lastManualBackstopAt: "2026-03-14T09:00:00.000Z",
        nextManualBackstopAt: "2026-03-14T09:10:00.000Z",
        prStates: {
          "7": {
            headSha: "headsha",
            lastSeenUpdatedAt: "2026-03-14T08:59:00.000Z",
            lastSeenIssueCommentId: null,
            lastSeenReviewCommentId: null,
            lastTargetedRefreshAt: null,
            nextTargetedRefreshAt: null,
          },
        },
      });
      expect(mocks.fetchIssueInfoMock).not.toHaveBeenCalled();
      expect(mocks.listPullRequestIssueCommentsMock).not.toHaveBeenCalled();
      expect(mocks.listPullRequestReviewCommentsMock).not.toHaveBeenCalled();
      expect(mocks.loggingMock).toHaveBeenCalledTimes(1);
      expect(mocks.loggingMock).toHaveBeenCalledWith({
        surface: "queue-poller",
        type: "queue",
        level: "info",
        event: "poll_baseline_primed",
        message: "Poll baseline primed",
        context: {
          repo: "ssoon-m/reviewflux",
        },
      });

      const queuedCount = database.connection
        .prepare(`SELECT COUNT(*) AS count FROM review_jobs`)
        .get() as { count: number };
      expect(queuedCount.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it("uses cheap detect plus targeted refresh without repo-wide comment feeds on the common path", async () => {
    const home = makeTempHome();
    homes.push(home);
    const database = new ReviewQueueDatabase({ home });

    try {
      const pollStateStore = new ReviewPollStateStore(database);
      const jobStore = new ReviewJobStore(database);
      const coordinator = new ReviewPollCoordinator(pollStateStore, jobStore);

      pollStateStore.saveProject({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 12,
        lastSeenReviewCommentId: 20,
        lastManualBackstopAt: "2026-03-14T08:55:00.000Z",
        nextManualBackstopAt: "2026-03-14T09:05:00.000Z",
        prStates: {
          "7": {
            headSha: "oldsha",
            lastSeenUpdatedAt: "2026-03-14T08:58:00.000Z",
            lastSeenIssueCommentId: 12,
            lastSeenReviewCommentId: 20,
            lastTargetedRefreshAt: null,
            nextTargetedRefreshAt: null,
          },
        },
      });

      mocks.listOpenPullRequestsMock.mockResolvedValue([
        makePullRequestSummary({
          number: 7,
          headSha: "newsha",
          updatedAt: "2026-03-14T09:00:00.000Z",
        }),
      ] satisfies PullRequestSummary[]);
      mockPullRequestComments({
        issueCommentsByPr: {
          7: [
            {
              id: 13,
              body: "@reviewflux please take another look",
              issue_url:
                "https://api.github.com/repos/ssoon-m/reviewflux/issues/7",
              html_url:
                "https://github.com/ssoon-m/reviewflux/issues/7#issuecomment-13",
              user: { login: "alice" },
            },
          ],
        },
        reviewCommentsByPr: {
          7: [
            {
              id: 21,
              body: "@reviewflux",
              pull_request_url:
                "https://api.github.com/repos/ssoon-m/reviewflux/pulls/7",
              html_url:
                "https://github.com/ssoon-m/reviewflux/pull/7#discussion_r21",
              in_reply_to_id: 55,
              user: { login: "bob" },
            },
          ],
        },
      });

      await coordinator.pollProject(makeProject());

      expect(mocks.ghApiPaginatedJsonMock).not.toHaveBeenCalled();
      expect(mocks.fetchIssueInfoMock).not.toHaveBeenCalled();
      expect(mocks.loggingMock).toHaveBeenCalledTimes(1);
      expect(mocks.loggingMock).toHaveBeenCalledWith({
        surface: "queue-poller",
        type: "queue",
        level: "info",
        event: "poll_jobs_enqueued",
        message: "Poll jobs enqueued",
        context: {
          repo: "ssoon-m/reviewflux",
          automaticCount: 1,
          manualCount: 2,
        },
      });

      const jobs = database.connection
        .prepare(
          `SELECT reason, event_name AS eventName FROM review_jobs ORDER BY id ASC`,
        )
        .all() as Array<{ reason: string; eventName: string }>;
      expect(jobs).toEqual([
        { reason: "on_push", eventName: "pull_request" },
        { reason: "manual_force", eventName: "issue_comment" },
        { reason: "manual_force", eventName: "pull_request_review_comment" },
      ]);

      expect(pollStateStore.loadProject("ssoon-m/reviewflux")).toEqual({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 12,
        lastSeenReviewCommentId: 20,
        lastManualBackstopAt: "2026-03-14T08:55:00.000Z",
        nextManualBackstopAt: "2026-03-14T09:05:00.000Z",
        prStates: {
          "7": {
            headSha: "newsha",
            lastSeenUpdatedAt: "2026-03-14T09:00:00.000Z",
            lastSeenIssueCommentId: 13,
            lastSeenReviewCommentId: 21,
            lastTargetedRefreshAt: "2026-03-14T09:00:00.000Z",
            nextTargetedRefreshAt: "2026-03-14T09:00:30.000Z",
          },
        },
      });
    } finally {
      database.close();
    }
  });

  it("runs the slower repo-wide manual backstop only when the backstop timer is due", async () => {
    const home = makeTempHome();
    homes.push(home);
    const database = new ReviewQueueDatabase({ home });

    try {
      const pollStateStore = new ReviewPollStateStore(database);
      const jobStore = new ReviewJobStore(database);
      const coordinator = new ReviewPollCoordinator(pollStateStore, jobStore);

      pollStateStore.saveProject({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 12,
        lastSeenReviewCommentId: 20,
        lastManualBackstopAt: "2026-03-14T08:45:00.000Z",
        nextManualBackstopAt: "2026-03-14T08:59:00.000Z",
        prStates: {
          "7": {
            headSha: "headsha",
            lastSeenUpdatedAt: "2026-03-14T08:58:00.000Z",
            lastSeenIssueCommentId: null,
            lastSeenReviewCommentId: null,
            lastTargetedRefreshAt: null,
            nextTargetedRefreshAt: null,
          },
        },
      });

      mocks.listOpenPullRequestsMock.mockResolvedValue([
        makePullRequestSummary({
          number: 7,
          headSha: "headsha",
          updatedAt: "2026-03-14T08:58:00.000Z",
        }),
      ] satisfies PullRequestSummary[]);
      mockRepoWideComments({
        issueComments: [
          {
            id: 13,
            body: "@reviewflux please take another look",
            issue_url: "https://api.github.com/repos/ssoon-m/reviewflux/issues/7",
            html_url:
              "https://github.com/ssoon-m/reviewflux/issues/7#issuecomment-13",
            user: { login: "alice" },
          },
        ],
        reviewComments: [
          {
            id: 21,
            body: "@reviewflux",
            pull_request_url:
              "https://api.github.com/repos/ssoon-m/reviewflux/pulls/7",
            html_url:
              "https://github.com/ssoon-m/reviewflux/pull/7#discussion_r21",
            in_reply_to_id: 55,
            user: { login: "bob" },
          },
        ],
      });
      mocks.fetchIssueInfoMock.mockResolvedValue({
        number: 7,
        pull_request: {},
      } satisfies IssueInfo);

      await coordinator.pollProject(makeProject());

      expect(mocks.listPullRequestIssueCommentsMock).not.toHaveBeenCalled();
      expect(mocks.listPullRequestReviewCommentsMock).not.toHaveBeenCalled();
      expect(mocks.ghApiPaginatedJsonMock).toHaveBeenCalledTimes(2);
      expect(mocks.fetchIssueInfoMock).toHaveBeenCalledWith(
        "ssoon-m/reviewflux",
        7,
      );

      const jobs = database.connection
        .prepare(
          `SELECT reason, event_name AS eventName FROM review_jobs ORDER BY id ASC`,
        )
        .all() as Array<{ reason: string; eventName: string }>;
      expect(jobs).toEqual([
        { reason: "manual_force", eventName: "issue_comment" },
        { reason: "manual_force", eventName: "pull_request_review_comment" },
      ]);
      expect(pollStateStore.loadProject("ssoon-m/reviewflux")).toEqual({
        repoKey: "ssoon-m/reviewflux",
        initialized: true,
        lastSeenIssueCommentId: 13,
        lastSeenReviewCommentId: 21,
        lastManualBackstopAt: "2026-03-14T09:00:00.000Z",
        nextManualBackstopAt: "2026-03-14T09:10:00.000Z",
        prStates: {
          "7": {
            headSha: "headsha",
            lastSeenUpdatedAt: "2026-03-14T08:58:00.000Z",
            lastSeenIssueCommentId: null,
            lastSeenReviewCommentId: null,
            lastTargetedRefreshAt: null,
            nextTargetedRefreshAt: null,
          },
        },
      });
    } finally {
      database.close();
    }
  });
});
