type ReviewKeyReason = "opened_once" | "on_push" | "manual_force";

function buildPostedReviewKey(params: {
  prNumber: number;
  prHeadSha: string;
  reason: ReviewKeyReason;
}): string {
  return `${params.prNumber}:${params.prHeadSha}:${params.reason}`;
}

export function hasPostedReviewKey(params: {
  postedReviewKeys: string[];
  prNumber: number;
  prHeadSha: string;
  reason: ReviewKeyReason;
}): boolean {
  return params.postedReviewKeys.includes(
    buildPostedReviewKey({
      prNumber: params.prNumber,
      prHeadSha: params.prHeadSha,
      reason: params.reason,
    }),
  );
}

export function createPostedReviewKey(params: {
  prNumber: number;
  prHeadSha: string;
  reason: ReviewKeyReason;
}): string {
  return buildPostedReviewKey(params);
}
