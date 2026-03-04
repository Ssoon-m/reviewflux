import { describe, expect, it, vi } from "vitest";
import {
  publishReviewWithInlineComments,
  type InlineReviewComment,
  type PublishReviewContext,
  type ReviewPublisherAdapter,
} from "../src/gateway/review-publisher.js";

function makeContext(body: string): PublishReviewContext {
  return {
    repo: "ssoon-m/reviewflux",
    prNumber: 123,
    body,
  };
}

describe("review publisher", () => {
  it("falls back to summary comment when no inline line reference exists", async () => {
    const context = makeContext("🧠 ReviewFlux Review\n\n### 요약\n- 중대한 수정 필요 없음");
    const postSummaryComment = vi.fn<ReviewPublisherAdapter["postSummaryComment"]>().mockResolvedValue(undefined);
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
    expect(postSummaryComment).toHaveBeenCalledWith(context, context.body);
  });

  it("posts inline comments for matched changed paths without top-level summary by default", async () => {
    const inlineComments: InlineReviewComment[] = [
      {
        path: "src/a.ts",
        line: 12,
        body: "- 심각도: [High]\n- 근거: null guard 없음\n- 리스크: 런타임 예외\n- 권장 조치: null 체크 추가",
      },
      {
        path: "src/ignored.ts",
        line: 7,
        body: "- 심각도: [Small]\n- 근거: 로그 과다\n- 리스크: 잡음\n- 권장 조치: 로그 수준 낮춤",
      },
    ];
    const context = {
      ...makeContext("🧠 ReviewFlux Review"),
      inlineComments,
    };

    const postSummaryComment = vi.fn<ReviewPublisherAdapter["postSummaryComment"]>().mockResolvedValue(undefined);
    const postInlineComment = vi.fn<ReviewPublisherAdapter["postInlineComment"]>().mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 1,
      postedSummaryFallback: false,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(1);
    expect(postInlineComment).toHaveBeenCalledWith(context, {
      path: "src/a.ts",
      line: 12,
      body: "- 심각도: [High]\n- 근거: null guard 없음\n- 리스크: 런타임 예외\n- 권장 조치: null 체크 추가",
    });
    expect(postSummaryComment).not.toHaveBeenCalled();
  });

  it("can also post compact summary after inline comments when enabled", async () => {
    const context = {
      ...makeContext("🧠 ReviewFlux Review\n\n### 요약\n- Request Changes"),
      inlineComments: [
        {
          path: "src/a.ts",
          line: 12,
          body: "- 심각도: [High]\n- 근거: null guard 없음\n- 리스크: 런타임 예외\n- 권장 조치: null 체크 추가",
        },
      ],
    };

    const postSummaryComment = vi.fn<ReviewPublisherAdapter["postSummaryComment"]>().mockResolvedValue(undefined);
    const postInlineComment = vi.fn<ReviewPublisherAdapter["postInlineComment"]>().mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/a.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter, postSummaryWhenInlinePosted: true });

    expect(result).toEqual({
      attemptedInlineCount: 1,
      postedInlineCount: 1,
      postedSummaryFallback: false,
    });
    expect(postSummaryComment).toHaveBeenCalledTimes(1);
    expect(postSummaryComment).toHaveBeenCalledWith(context, context.body);
  });

  it("falls back to full summary when inline comments all fail", async () => {
    const context = {
      ...makeContext("🧠 ReviewFlux Review"),
      inlineComments: [
        {
          path: "src/a.ts",
          line: 42,
          body: "- 심각도: [Medium]\n- 근거: 타입 가드 누락\n- 리스크: 런타임 오류\n- 권장 조치: 타입 가드 추가",
        },
      ],
    };

    const postSummaryComment = vi.fn<ReviewPublisherAdapter["postSummaryComment"]>().mockResolvedValue(undefined);
    const postInlineComment = vi.fn<ReviewPublisherAdapter["postInlineComment"]>().mockRejectedValue(new Error("validation failed"));
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
    expect(postSummaryComment).toHaveBeenCalledWith(context, context.body);
  });

  it("posts all provided inline comments when paths are changed", async () => {
    const context = {
      ...makeContext("🧠 ReviewFlux Review"),
      inlineComments: [
        {
          path: "src/cli/config.ts",
          line: 221,
          body: "- 심각도: [High]\n- 근거: 마이그레이션 경로에서 oauth 값 누락\n- 리스크: 업그레이드 직후 인증 실패\n- 권장 조치: oauth 폴백 전달 보장",
        },
        {
          path: "src/cli/config.ts",
          line: 162,
          body: "- 심각도: [High]\n- 근거: 마이그레이션 경로에서 oauth 값 누락\n- 리스크: 업그레이드 직후 인증 실패\n- 권장 조치: oauth 폴백 전달 보장",
        },
      ],
    };

    const postSummaryComment = vi.fn<ReviewPublisherAdapter["postSummaryComment"]>().mockResolvedValue(undefined);
    const postInlineComment = vi.fn<ReviewPublisherAdapter["postInlineComment"]>().mockResolvedValue(undefined);
    const adapter: ReviewPublisherAdapter = {
      listChangedPaths: vi.fn().mockResolvedValue(["src/cli/config.ts"]),
      postInlineComment,
      postSummaryComment,
    };

    const result = await publishReviewWithInlineComments({ context, adapter });

    expect(result).toEqual({
      attemptedInlineCount: 2,
      postedInlineCount: 2,
      postedSummaryFallback: false,
    });
    expect(postInlineComment).toHaveBeenCalledTimes(2);
    expect(postInlineComment).toHaveBeenNthCalledWith(1, context, {
      path: "src/cli/config.ts",
      line: 221,
      body: "- 심각도: [High]\n- 근거: 마이그레이션 경로에서 oauth 값 누락\n- 리스크: 업그레이드 직후 인증 실패\n- 권장 조치: oauth 폴백 전달 보장",
    });
    expect(postInlineComment).toHaveBeenNthCalledWith(2, context, {
      path: "src/cli/config.ts",
      line: 162,
      body: "- 심각도: [High]\n- 근거: 마이그레이션 경로에서 oauth 값 누락\n- 리스크: 업그레이드 직후 인증 실패\n- 권장 조치: oauth 폴백 전달 보장",
    });
  });
});
