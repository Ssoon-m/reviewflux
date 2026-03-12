import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewFluxConfig } from "../src/cli/config.js";
import type { ReviewState } from "../src/review/state-store.js";

const mocks = vi.hoisted(() => ({
  getModelMock: vi.fn(),
  createLlmProviderMock: vi.fn(),
  generateReplyMock: vi.fn(),
  resolveReviewOutputFromModelMock: vi.fn(),
  postReviewOutputMock: vi.fn(),
  buildRemoteProjectContextTextMock: vi.fn(),
  fetchPullRequestDetailMock: vi.fn(),
  ghExecMock: vi.fn(),
  listPullRequestFilesMock: vi.fn(),
  listPullRequestIssueCommentsMock: vi.fn(),
  listPullRequestReviewCommentsMock: vi.fn(),
  postInlineReviewCommentMock: vi.fn(),
  postPullRequestCommentMock: vi.fn(),
  postPullRequestReviewReplyMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: mocks.getModelMock,
}));

vi.mock("../src/llm/factory.js", () => ({
  createLlmProvider: mocks.createLlmProviderMock,
}));

vi.mock("../src/llm/review-output.js", () => ({
  resolveReviewOutputFromModel: mocks.resolveReviewOutputFromModelMock,
}));

vi.mock("../src/gateway/review-posting.js", () => ({
  postReviewOutput: mocks.postReviewOutputMock,
}));

vi.mock("../src/review/github.js", () => ({
  buildRemoteProjectContextText: mocks.buildRemoteProjectContextTextMock,
  fetchPullRequestDetail: mocks.fetchPullRequestDetailMock,
  ghExec: mocks.ghExecMock,
  listPullRequestFiles: mocks.listPullRequestFilesMock,
  listPullRequestIssueComments: mocks.listPullRequestIssueCommentsMock,
  listPullRequestReviewComments: mocks.listPullRequestReviewCommentsMock,
  postInlineReviewComment: mocks.postInlineReviewCommentMock,
  postPullRequestComment: mocks.postPullRequestCommentMock,
  postPullRequestReviewReply: mocks.postPullRequestReviewReplyMock,
}));

import { runReviewJob } from "../src/review/runtime.js";

function buildFindingBody(summary: string, detail: string): string {
  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    summary,
    "",
    "### Findings (ordered by severity)",
    "",
    "- Severity: [Medium]",
    `- Detail: ${detail}`,
    "",
    "### Verification Notes",
    "- Verified: test",
    "- Not Verified: runtime",
  ].join("\n");
}

function makeConfig(): ReviewFluxConfig {
  return {
    appName: "reviewflux",
    llm: "openai",
    authMode: "apikey",
    apiKey: { key: "test-key" },
    llmApiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    projects: {
      "ssoon-m/reviewflux": {
        repo: "ssoon-m/reviewflux",
        pr: {
          mode: "on_push",
          forceCommand: "@reviewflux",
        },
        context: { mode: "default" },
      },
    },
  };
}

function makeState(): ReviewState {
  return { projects: {} };
}

beforeEach(() => {
  vi.restoreAllMocks();

  mocks.getModelMock.mockReset();
  mocks.createLlmProviderMock.mockReset();
  mocks.generateReplyMock.mockReset();
  mocks.resolveReviewOutputFromModelMock.mockReset();
  mocks.postReviewOutputMock.mockReset();
  mocks.buildRemoteProjectContextTextMock.mockReset();
  mocks.fetchPullRequestDetailMock.mockReset();
  mocks.ghExecMock.mockReset();
  mocks.listPullRequestFilesMock.mockReset();
  mocks.listPullRequestIssueCommentsMock.mockReset();
  mocks.listPullRequestReviewCommentsMock.mockReset();
  mocks.postInlineReviewCommentMock.mockReset();
  mocks.postPullRequestCommentMock.mockReset();
  mocks.postPullRequestReviewReplyMock.mockReset();

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  mocks.createLlmProviderMock.mockReturnValue({
    generateReply: mocks.generateReplyMock,
  });
  mocks.generateReplyMock.mockResolvedValue('{"findings":[]}');
  mocks.resolveReviewOutputFromModelMock.mockReturnValue({ findings: [] });
  mocks.buildRemoteProjectContextTextMock.mockResolvedValue("");
  mocks.fetchPullRequestDetailMock.mockResolvedValue({
    number: 7,
    title: "Test PR",
    body: "test body",
    html_url: "https://github.com/ssoon-m/reviewflux/pull/7",
    head: { sha: "headsha" },
    base: { sha: "basesha" },
  });
  mocks.ghExecMock.mockResolvedValue("diff --git a/src/a.ts b/src/a.ts");
  mocks.listPullRequestFilesMock.mockResolvedValue([{ filename: "src/a.ts" }]);
  mocks.listPullRequestIssueCommentsMock.mockResolvedValue([]);
  mocks.listPullRequestReviewCommentsMock.mockResolvedValue([]);
  mocks.postInlineReviewCommentMock.mockResolvedValue(undefined);
  mocks.postPullRequestCommentMock.mockResolvedValue(undefined);
  mocks.postPullRequestReviewReplyMock.mockResolvedValue(undefined);
  mocks.postReviewOutputMock.mockResolvedValue(undefined);
});

describe("runReviewJob", () => {
  it("replies in the review thread for manual review comment triggers", async () => {
    const state = makeState();
    const body = buildFindingBody("New finding", "reply in thread");
    mocks.resolveReviewOutputFromModelMock.mockReturnValue({
      findings: [{ path: "", line: "", body }],
    });
    mocks.postReviewOutputMock.mockImplementationOnce(async (params) => {
      await params.postSummaryComment({
        repo: params.repo,
        prNumber: params.prNumber,
        body,
      });
    });

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "pull_request_review_comment",
        commentId: "321",
        reviewReplyToCommentId: "123",
        senderLogin: "ssoon-m",
      },
    });

    expect(mocks.postPullRequestReviewReplyMock).toHaveBeenCalledWith({
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      replyToCommentId: "123",
      body,
    });
    expect(mocks.postReviewOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "ssoon-m/reviewflux",
        prNumber: 7,
        prHeadSha: "headsha",
        postSummaryWhenInlinePosted: true,
      }),
    );
    expect(mocks.postPullRequestCommentMock).not.toHaveBeenCalled();
    expect(
      state.projects["ssoon-m/reviewflux"]?.handledManualTriggerKeys,
    ).toContain("pull_request_review_comment:321");
  });

  it("posts an issue follow-up comment for manual issue comment triggers", async () => {
    const state = makeState();
    const body = buildFindingBody("Issue trigger finding", "follow up body");
    mocks.resolveReviewOutputFromModelMock.mockReturnValue({
      findings: [{ path: "", line: "", body }],
    });
    mocks.postReviewOutputMock.mockImplementationOnce(async (params) => {
      await params.postSummaryComment({
        repo: params.repo,
        prNumber: params.prNumber,
        body,
      });
    });

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "issue_comment",
        commentId: "555",
        commentUrl: "https://github.com/ssoon-m/reviewflux/pull/7#issuecomment-555",
        senderLogin: "ssoon-m",
      },
    });

    expect(mocks.postPullRequestReviewReplyMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestCommentMock).toHaveBeenCalledWith({
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      body: expect.stringContaining(
        "@ssoon-m [trigger comment](https://github.com/ssoon-m/reviewflux/pull/7#issuecomment-555)",
      ),
    });
    expect(
      state.projects["ssoon-m/reviewflux"]?.handledManualTriggerKeys,
    ).toContain("issue_comment:555");
  });

  it("reruns a manual review even when the current head has a recorded review", async () => {
    const state: ReviewState = {
      projects: {
        "ssoon-m/reviewflux": {
          initialized: true,
          prHeads: {},
          seenForceCommentIds: [],
          postedReviewKeys: ["7:headsha:opened_once"],
          handledManualTriggerKeys: [],
        },
      },
    };
    const body = buildFindingBody("Manual rerun finding", "re-evaluated body");
    mocks.resolveReviewOutputFromModelMock.mockReturnValue({
      findings: [{ path: "", line: "", body }],
    });
    mocks.postReviewOutputMock.mockImplementationOnce(async (params) => {
      await params.postSummaryComment({
        repo: params.repo,
        prNumber: params.prNumber,
        body,
      });
    });

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "issue_comment",
        commentId: "555",
        commentUrl: "https://github.com/ssoon-m/reviewflux/pull/7#issuecomment-555",
        senderLogin: "ssoon-m",
      },
    });

    expect(mocks.generateReplyMock).toHaveBeenCalled();
    expect(mocks.postReviewOutputMock).toHaveBeenCalledTimes(1);
    expect(mocks.postPullRequestCommentMock).toHaveBeenCalledWith({
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      body: expect.stringContaining("Manual rerun finding"),
    });
    expect(
      state.projects["ssoon-m/reviewflux"]?.handledManualTriggerKeys,
    ).toContain("issue_comment:555");
  });

  it("posts a no-new-finding reply when a manual trigger matches an existing ReviewFlux finding", async () => {
    const state = makeState();
    const body = buildFindingBody("Duplicate finding", "same detail");
    mocks.resolveReviewOutputFromModelMock.mockReturnValue({
      findings: [{ path: "", line: "", body }],
    });
    mocks.listPullRequestIssueCommentsMock.mockResolvedValue([
      { body },
    ]);

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "pull_request_review_comment",
        commentId: "321",
        reviewReplyToCommentId: "123",
      },
    });

    expect(mocks.postReviewOutputMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestReviewReplyMock).toHaveBeenCalledWith({
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      replyToCommentId: "123",
      body: expect.stringContaining(
        "no new issues beyond existing ReviewFlux findings",
      ),
    });
  });

  it("skips posting duplicate automatic findings but still records the reviewed sha", async () => {
    const state = makeState();
    const body = buildFindingBody("Duplicate finding", "same detail");
    mocks.resolveReviewOutputFromModelMock.mockReturnValue({
      findings: [{ path: "", line: "", body }],
    });
    mocks.listPullRequestReviewCommentsMock.mockResolvedValue([
      { body },
    ]);

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "on_push",
      state,
    });

    expect(mocks.postReviewOutputMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestCommentMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestReviewReplyMock).not.toHaveBeenCalled();
    expect(state.projects["ssoon-m/reviewflux"]?.postedReviewKeys).toContain(
      "7:headsha:on_push",
    );
  });

  it("short-circuits automatic reviews already recorded for the current sha", async () => {
    const state: ReviewState = {
      projects: {
        "ssoon-m/reviewflux": {
          initialized: true,
          prHeads: {},
          seenForceCommentIds: [],
          postedReviewKeys: ["7:headsha:on_push"],
          handledManualTriggerKeys: [],
        },
      },
    };

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "on_push",
      state,
    });

    expect(mocks.generateReplyMock).not.toHaveBeenCalled();
    expect(mocks.postReviewOutputMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestCommentMock).not.toHaveBeenCalled();
  });

  it("short-circuits manual triggers that were already handled", async () => {
    const state: ReviewState = {
      projects: {
        "ssoon-m/reviewflux": {
          initialized: true,
          prHeads: {},
          seenForceCommentIds: [],
          postedReviewKeys: [],
          handledManualTriggerKeys: ["issue_comment:555"],
        },
      },
    };

    await runReviewJob({
      config: makeConfig(),
      project: makeConfig().projects!["ssoon-m/reviewflux"],
      repo: "ssoon-m/reviewflux",
      prNumber: 7,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "issue_comment",
        commentId: "555",
      },
    });

    expect(mocks.generateReplyMock).not.toHaveBeenCalled();
    expect(mocks.postReviewOutputMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestCommentMock).not.toHaveBeenCalled();
    expect(mocks.postPullRequestReviewReplyMock).not.toHaveBeenCalled();
  });
});
