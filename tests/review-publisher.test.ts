import { describe, expect, it, vi } from "vitest";
import {
  publishReviewWithInlineComments,
  type InlineReviewComment,
  type PublishReviewContext,
  type ReviewFinding,
  type ReviewPublisherAdapter,
} from "../src/gateway/review-publisher";

function makeContext(findings: ReviewFinding[] = []): PublishReviewContext {
  return {
    repo: "ssoon-m/reviewflux",
    prNumber: 123,
    findings,
  };
}

describe("review publisher", () => {
  it("posts no-issue summary when findings are empty", async () => {
    const context = makeContext();
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    });
    expect(adapter.listChangedPaths).not.toHaveBeenCalled();
    expect(adapter.postInlineComment).not.toHaveBeenCalled();
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "Great news - no actionable issues were found in this PR.",
    );
  });

  it("keeps no-issue summaries normalized without extra prefix metadata", async () => {
    const context = makeContext();
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue([]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    await publishReviewWithInlineComments({ context, adapter });

    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "Great news - no actionable issues were found in this PR.",
    );
  });

  it("posts summary for general findings without inline anchors", async () => {
    const context = makeContext([
      {
        path: "",
        line: "",
        body: "General finding without an anchor",
      },
    ]);
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    });
    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "General finding without an anchor",
    );
  });

  it("posts one top-level comment per general finding", async () => {
    const context = makeContext([
      {
        path: "",
        line: "",
        body: "First general finding",
      },
      {
        path: "",
        line: "",
        body: "Second general finding",
      },
    ]);
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue([]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    await publishReviewWithInlineComments({ context, adapter });

    expect(postSummaryComment).toHaveBeenCalledTimes(2);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "First general finding",
    );
    expect(postSummaryComment.mock.calls[1]?.[1]).toContain(
      "Second general finding",
    );
  });

  it("posts leftover summary when some anchored findings cannot be posted", async () => {
    const findings: ReviewFinding[] = [
      {
        path: "src/a.ts",
        line: 12,
        body: "- Severity: [High]\n- Detail: null guard missing",
      },
      {
        path: "src/ignored.ts",
        line: 7,
        body: "- Severity: [Small]\n- Detail: noisy logging",
      },
    ];
    const context = makeContext(findings);

    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const postInlineComment = vi
      .fn<ReviewPublisherAdapter["postInlineComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 1,
      postedTopLevelFallback: true,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
    expect(postInlineComment).toHaveBeenCalledWith(context, {
      path: "src/a.ts",
      line: 12,
      body:
        "🧠 ReviewFlux Review\n\n- Severity: [High]\n- Detail: null guard missing",
    } satisfies InlineReviewComment);
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain("noisy logging");
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain(
      "src/ignored.ts:7",
    );
  });

  it("posts leftover general findings even when one inline comment succeeds", async () => {
    const context = makeContext([
      {
        path: "src/a.ts",
        line: 12,
        body: "- Severity: [High]\n- Detail: anchored finding",
      },
      {
        path: "",
        line: "",
        body: "General finding that must not disappear",
      },
    ]);

    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const postInlineComment = vi
      .fn<ReviewPublisherAdapter["postInlineComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 1,
      postedTopLevelFallback: true,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "General finding that must not disappear",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain("src/a.ts:12");
  });

  it("does not post a top-level comment when inline comments fully succeed", async () => {
    const context = makeContext([
      {
        path: "src/a.ts",
        line: 12,
        body: "- Severity: [High]\n- Detail: null guard missing",
      },
    ]);

    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const postInlineComment = vi
      .fn<ReviewPublisherAdapter["postInlineComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({
      context,
      adapter,
    });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 1,
      postedTopLevelFallback: false,
    });
    expect(postSummaryComment).not.toHaveBeenCalled();
  });

  it("falls back to summary when inline comments all fail", async () => {
    const context = makeContext([
      {
        path: "src/a.ts",
        line: 42,
        body: "- Severity: [Medium]\n- Detail: missing type guard",
      },
    ]);

    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const postInlineComment = vi
      .fn<ReviewPublisherAdapter["postInlineComment"]>()
      .mockRejectedValue(new Error("validation failed"));
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "missing type guard",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain("src/a.ts:42");
  });

  it("uses a general fallback summary when anchored findings are filtered out", async () => {
    const context = makeContext([
      {
        path: "src/not-changed.ts",
        line: 10,
        body: "- Detail: anchored finding",
      },
      {
        path: "",
        line: "",
        body: "General finding that should survive",
      },
    ]);

    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/other.ts"]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    });
    expect(postSummaryComment.mock.calls[0]?.[1].startsWith("🧠 ReviewFlux Review\n\n")).toBe(true);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "General finding that should survive",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain(
      "src/not-changed.ts:10",
    );
  });

  it("posts a detailed top-level review body in summary-only mode", async () => {
    const detailedBody = [
      "🧠 ReviewFlux Review",
      "",
      "### Summary",
      "The runtime guard can reject a valid owner trigger.",
      "",
      "### Findings (ordered by severity)",
      "",
      "- Severity: [High]",
      "- Detail: owner association is not accepted in this branch.",
      "",
      "### Verification Notes",
      "- Verified: inspected guard branch",
      "- Not Verified: live GitHub behavior",
    ].join("\n");
    const context = {
      ...makeContext([
        {
          path: "src/gateway/http-server.ts",
          line: 474,
          body: detailedBody,
        },
      ]),
      deliveryMode: "top-level-only",
    } satisfies PublishReviewContext;

    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/gateway/http-server.ts"]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    });
    expect(adapter.listChangedPaths).not.toHaveBeenCalled();
    expect(adapter.postInlineComment).not.toHaveBeenCalled();
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect((postSummaryComment.mock.calls[0]?.[1].match(/🧠 ReviewFlux Review/g) ?? []).length).toBe(1);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "The runtime guard can reject a valid owner trigger.",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain(
      "src/gateway/http-server.ts:474",
    );
  });

  it("posts a direct structured fallback body without wrapping it again", async () => {
    const directBody = [
      "🧠 ReviewFlux Review",
      "",
      "### Summary",
      "Review completed, but the model output format was invalid.",
      "",
      "### Verification Notes",
      "- Verified: Review request executed.",
      "- Not Verified: invalid model output format",
    ].join("\n");
    const context = makeContext([
      {
        path: "",
        line: "",
        body: directBody,
      },
    ]);
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue([]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    await publishReviewWithInlineComments({ context, adapter });

    expect(postSummaryComment.mock.calls[0]?.[1]).toBe(directBody);
  });

  it("posts multiple titled top-level bodies as separate comments", async () => {
    const context = makeContext([
      {
        path: "",
        line: "",
        body: [
          "🧠 ReviewFlux Review",
          "",
          "### Summary",
          "First body",
        ].join("\n"),
      },
      {
        path: "",
        line: "",
        body: [
          "🧠 ReviewFlux Review",
          "",
          "### Summary",
          "Second body",
        ].join("\n"),
      },
    ]);
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue([]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    await publishReviewWithInlineComments({ context, adapter });

    expect(postSummaryComment).toHaveBeenCalledTimes(2);
    expect((postSummaryComment.mock.calls[0]?.[1].match(/🧠 ReviewFlux Review/g) ?? []).length).toBe(1);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain("First body");
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain("Second body");
    expect((postSummaryComment.mock.calls[1]?.[1].match(/🧠 ReviewFlux Review/g) ?? []).length).toBe(1);
    expect(postSummaryComment.mock.calls[1]?.[1]).toContain("Second body");
    expect(postSummaryComment.mock.calls[1]?.[1]).not.toContain("First body");
  });
});
