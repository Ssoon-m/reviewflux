import type { ManualReviewTrigger } from "../manual-trigger.js";
import type { ReviewTriggerReason } from "../types.js";

export type ReviewJobStatus = "pending" | "running" | "done" | "failed";

export type ReviewJobPayload = {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  manualTrigger?: ManualReviewTrigger;
};

export type EnqueueReviewJobInput = {
  repoKey: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  eventName: string;
  eventKey: string;
  payload: ReviewJobPayload;
  availableAt?: string;
};

export type ReviewJobRecord = {
  id: number;
  repoKey: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  eventName: string;
  eventKey: string;
  payload: ReviewJobPayload;
  status: ReviewJobStatus;
  attempts: number;
  availableAt: string;
  claimedAt: string | null;
  workerId: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPollSnapshot = {
  repoKey: string;
  initialized: boolean;
  lastSeenIssueCommentId: number | null;
  lastSeenReviewCommentId: number | null;
  prHeads: Record<string, string>;
};
