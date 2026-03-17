export const REVIEW_COMMENT_TITLE = "🧠 ReviewFlux Review";

export function stripReviewCommentTitle(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith(REVIEW_COMMENT_TITLE)) return trimmed;

  const remainder = trimmed.slice(REVIEW_COMMENT_TITLE.length);
  return remainder.replace(/^\s+/, "").trim();
}

export function ensureReviewCommentTitle(body: string): string {
  const content = stripReviewCommentTitle(body);
  if (content.length === 0) {
    return REVIEW_COMMENT_TITLE;
  }

  return [REVIEW_COMMENT_TITLE, "", content].join("\n").trim();
}
