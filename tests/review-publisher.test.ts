import { describe, expect, it, vi } from "vitest";
import {
  publishReviewWithInlineComments,
  type InlineReviewComment,
  type PublishReviewContext,
  type ReviewFinding,
  type ReviewPublisherAdapter,
} from "../src/gateway/review-publisher.js";

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
      postedSummaryFallback: true,
    });
    expect(adapter.listChangedPaths).not.toHaveBeenCalled();
    expect(adapter.postInlineComment).not.toHaveBeenCalled();
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "Great news - no actionable issues were found in this PR.",
    );
  });

  it("adds summary prefix to no-issue summaries", async () => {
    const context = {
      ...makeContext(),
      summaryPrefix: "Requested by @ssoon-m: https://example.com/comment/2",
    } satisfies PublishReviewContext;
    const postSummaryComment = vi
      .fn<ReviewPublisherAdapter["postSummaryComment"]>()
      .mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue([]),
      postInlineComment: vi.fn().mockResolvedValue(undefined),
      postSummaryComment,
    };

    await publishReviewWithInlineComments({ context, adapter });

    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "Requested by @ssoon-m: https://example.com/comment/2",
    );
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
      postedSummaryFallback: true,
    });
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "General finding without an anchor",
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
      postedSummaryFallback: true,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
    expect(postInlineComment).toHaveBeenCalledWith(context, {
      path: "src/a.ts",
      line: 12,
      body: "- Severity: [High]\n- Detail: null guard missing",
    } satisfies InlineReviewComment);
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
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
      postedSummaryFallback: true,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "General finding that must not disappear",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain("src/a.ts:12");
  });

  it("can also post compact summary after inline comments when enabled", async () => {
    const context = {
      ...makeContext([
        {
          path: "src/a.ts",
          line: 12,
          body: "- Severity: [High]\n- Detail: null guard missing",
        },
      ]),
      summaryPrefix: "Requested by @ssoon-m: https://example.com/comment/1",
    } satisfies PublishReviewContext;

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
      postSummaryWhenInlinePosted: true,
    });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 1,
      postedSummaryFallback: false,
    });
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "Requested by @ssoon-m: https://example.com/comment/1",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain("src/a.ts:12");
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
      postedSummaryFallback: true,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
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
      postedSummaryFallback: true,
    });
    expect(postSummaryComment.mock.calls[0]?.[1]).toContain(
      "General finding that should survive",
    );
    expect(postSummaryComment.mock.calls[0]?.[1]).not.toContain(
      "src/not-changed.ts:10",
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
});
