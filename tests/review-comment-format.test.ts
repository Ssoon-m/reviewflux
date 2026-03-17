import { describe, expect, it } from "vitest";
import {
  ensureReviewCommentTitle,
  REVIEW_COMMENT_TITLE,
  stripReviewCommentTitle,
} from "../src/contracts/review-comment-format.js";

describe("review comment format contract", () => {
  it("adds the shared title wrapper exactly once", () => {
    expect(ensureReviewCommentTitle("### Summary\nBody")).toBe(
      `${REVIEW_COMMENT_TITLE}\n\n### Summary\nBody`,
    );
    expect(
      ensureReviewCommentTitle(`${REVIEW_COMMENT_TITLE}\n\n### Summary\nBody`),
    ).toBe(`${REVIEW_COMMENT_TITLE}\n\n### Summary\nBody`);
  });

  it("strips the shared title wrapper without disturbing the body", () => {
    expect(
      stripReviewCommentTitle(`${REVIEW_COMMENT_TITLE}\n\n### Summary\nBody`),
    ).toBe("### Summary\nBody");
    expect(stripReviewCommentTitle("### Summary\nBody")).toBe(
      "### Summary\nBody",
    );
  });
});
