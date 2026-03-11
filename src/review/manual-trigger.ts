export type ManualReviewTrigger = {
  eventName: "issue_comment" | "pull_request_review_comment";
  commentId: string;
  commentUrl?: string;
  senderLogin?: string;
  reviewReplyToCommentId?: string | null;
};

export function buildHandledManualTriggerKey(
  trigger: ManualReviewTrigger,
): string {
  return `${trigger.eventName}:${trigger.commentId}`;
}

export function canReplyInReviewThread(
  trigger: ManualReviewTrigger | undefined,
): trigger is ManualReviewTrigger & { reviewReplyToCommentId: string } {
  return (
    !!trigger &&
    trigger.eventName === "pull_request_review_comment" &&
    typeof trigger.reviewReplyToCommentId === "string" &&
    trigger.reviewReplyToCommentId.trim().length > 0
  );
}
