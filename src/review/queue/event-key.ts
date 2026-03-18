import { normalizeRepoKey } from "../../lib/repo/input";
import type { ManualReviewTrigger } from "../manual-trigger";
import type { ReviewTriggerReason } from "../types";

export function buildAutomaticReviewEventKey(params: {
  repo: string;
  prNumber: number;
  reason: Exclude<ReviewTriggerReason, "manual_force">;
  prHeadSha: string;
}): string {
  return [
    "pr",
    params.reason,
    normalizeRepoKey(params.repo),
    String(params.prNumber),
    params.prHeadSha,
  ].join(":");
}

export function buildManualReviewEventKey(
  trigger: ManualReviewTrigger,
): string {
  return `${trigger.eventName}:${trigger.commentId}`;
}
