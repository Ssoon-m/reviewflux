import { describe, expect, it, vi } from "vitest";
import { postReviewOutput } from "../src/gateway/review-posting.js";

function makeParams(overrides: Partial<Parameters<typeof postReviewOutput>[0]> = {}) {
  return {
    repo: "ssoon-m/reviewflux",
    prNumber: 42,
    prHeadSha: "abc123head",
    findings: [],
    deliveryMode: undefined,
    diff: "",
    listPullRequestFiles: vi.fn().mockResolvedValue([]),
    postSummaryComment: vi.fn().mockResolvedValue(undefined),
    postInlineReviewComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("review posting", () => {
  it("posts inline comment when the requested line is exactly commentable", async () => {
    const listPullRequestFiles = vi
      .fn()
      .mockResolvedValue([{ filename: "src/a.ts" }]);
    const postSummaryComment = vi.fn().mockResolvedValue(undefined);
    const postInlineReviewComment = vi.fn().mockResolvedValue(undefined);
    const params = makeParams({
      findings: [
        {
          path: "src/a.ts",
          line: 2,
          body: "- Detail: exact line comment",
        },
      ],
      diff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,3 @@",
        " line one",
        "+line two",
        " line three",
      ].join("\n"),
      listPullRequestFiles,
      postSummaryComment,
      postInlineReviewComment,
    });

    await postReviewOutput(params);

    expect(listPullRequestFiles).toHaveBeenCalledWith("ssoon-m/reviewflux", 42);
    expect(postInlineReviewComment).toHaveBeenCalledTimes(1);
    expect(postInlineReviewComment).toHaveBeenCalledWith({
      repo: "ssoon-m/reviewflux",
      prNumber: 42,
      prHeadSha: "abc123head",
      comment: {
        path: "src/a.ts",
        line: 2,
        body: "🧠 ReviewFlux Review\n\n- Detail: exact line comment",
      },
    });
    expect(postSummaryComment).not.toHaveBeenCalled();
  });

  it("falls back to top-level comment when the requested line is absent from the diff", async () => {
    const listPullRequestFiles = vi
      .fn()
      .mockResolvedValue([{ filename: "src/a.ts" }]);
    const postSummaryComment = vi.fn().mockResolvedValue(undefined);
    const postInlineReviewComment = vi.fn().mockResolvedValue(undefined);
    const params = makeParams({
      findings: [
        {
          path: "src/a.ts",
          line: 99,
          body: "- Detail: cannot resolve exact diff line",
        },
      ],
      diff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,3 @@",
        " line one",
        "+line two",
        " line three",
      ].join("\n"),
      listPullRequestFiles,
      postSummaryComment,
      postInlineReviewComment,
    });

    await postReviewOutput(params);

    expect(postInlineReviewComment).not.toHaveBeenCalled();
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment).toHaveBeenCalledWith({
      repo: "ssoon-m/reviewflux",
      prNumber: 42,
      body: expect.stringContaining("- Detail: cannot resolve exact diff line"),
    });
    expect(postSummaryComment.mock.calls[0]?.[0].body).not.toContain(
      "src/a.ts:99",
    );
  });

  it("resolves exact commentable lines across multiple hunks", async () => {
    const listPullRequestFiles = vi
      .fn()
      .mockResolvedValue([{ filename: "src/a.ts" }]);
    const postSummaryComment = vi.fn().mockResolvedValue(undefined);
    const postInlineReviewComment = vi.fn().mockResolvedValue(undefined);
    const params = makeParams({
      findings: [
        {
          path: "src/a.ts",
          line: 12,
          body: "- Detail: second hunk exact line",
        },
      ],
      diff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+two updated",
        " three",
        "@@ -10,3 +10,4 @@",
        " ten",
        " eleven",
        "+twelve",
        " thirteen",
      ].join("\n"),
      listPullRequestFiles,
      postSummaryComment,
      postInlineReviewComment,
    });

    await postReviewOutput(params);

    expect(postInlineReviewComment).toHaveBeenCalledTimes(1);
    expect(postInlineReviewComment.mock.calls[0]?.[0]).toMatchObject({
      repo: "ssoon-m/reviewflux",
      prNumber: 42,
      prHeadSha: "abc123head",
    });
    expect(postInlineReviewComment.mock.calls[0]?.[0].comment).toMatchObject({
      path: "src/a.ts",
      line: 12,
      body: "🧠 ReviewFlux Review\n\n- Detail: second hunk exact line",
    });
    expect(postSummaryComment).not.toHaveBeenCalled();
  });

  it("uses only top-level comments when deliveryMode is top-level-only", async () => {
    const listPullRequestFiles = vi
      .fn()
      .mockResolvedValue([{ filename: "src/a.ts" }]);
    const postSummaryComment = vi.fn().mockResolvedValue(undefined);
    const postInlineReviewComment = vi.fn().mockResolvedValue(undefined);
    const params = makeParams({
      findings: [
        {
          path: "src/a.ts",
          line: 2,
          body: "### Summary\nTop-level only review",
        },
      ],
      deliveryMode: "top-level-only",
      diff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,1 +1,2 @@",
        " line one",
        "+line two",
      ].join("\n"),
      listPullRequestFiles,
      postSummaryComment,
      postInlineReviewComment,
    });

    await postReviewOutput(params);

    expect(listPullRequestFiles).not.toHaveBeenCalled();
    expect(postInlineReviewComment).not.toHaveBeenCalled();
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[0].body).toBe(
      "🧠 ReviewFlux Review\n\n### Summary\nTop-level only review",
    );
  });

});
