import type { ReviewFluxConfig } from "../cli/config.js";
import { normalizeRepoKey } from "../llm/model-routing.js";

type EventName =
  | "pull_request"
  | "issue_comment"
  | "pull_request_review_comment";
type PullRequestAction = "opened" | "synchronize";

export type PrEventInput = {
  eventName: EventName;
  repo: string;
  action?: string;
  commentBody?: string;
};

export type PrEventDecision = {
  shouldReview: boolean;
  reason:
    | "project_not_configured"
    | "manual_force"
    | "opened_once"
    | "on_push"
    | "ignored";
  force: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasForceCommand(commentBody: string | undefined, forceCommand: string): boolean {
  if (!commentBody) return false;
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(forceCommand)}\\b`, "i");
  return pattern.test(commentBody);
}

function isPullRequestTrigger(
  action: string | undefined,
  mode: "opened_once" | "on_push",
): boolean {
  const normalized = (action ?? "").trim() as PullRequestAction;
  if (mode === "opened_once") {
    return normalized === "opened";
  }
  return normalized === "opened" || normalized === "synchronize";
}

export function decidePrReview(
  config: ReviewFluxConfig,
  input: PrEventInput,
): PrEventDecision {
  const project = config.projects?.[normalizeRepoKey(input.repo)];
  if (!project) {
    return {
      shouldReview: false,
      reason: "project_not_configured",
      force: false,
    };
  }

  const forceCommand = project.pr.forceCommand?.trim() || "@reviewflux";
  const force = hasForceCommand(input.commentBody, forceCommand);
  if (
    force &&
    (input.eventName === "issue_comment" ||
      input.eventName === "pull_request_review_comment")
  ) {
    return { shouldReview: true, reason: "manual_force", force: true };
  }

  if (input.eventName === "pull_request") {
    const shouldReview = isPullRequestTrigger(input.action, project.pr.mode);
    if (!shouldReview)
      return { shouldReview: false, reason: "ignored", force: false };
    return {
      shouldReview: true,
      reason: project.pr.mode === "opened_once" ? "opened_once" : "on_push",
      force: false,
    };
  }

  return { shouldReview: false, reason: "ignored", force: false };
}
