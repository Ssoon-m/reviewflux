import type { ReviewFluxConfig } from "../cli/config";

export type ProjectConfig = NonNullable<ReviewFluxConfig["projects"]>[string];

export type ReviewTriggerReason = "opened_once" | "on_push" | "manual_force";

export type PullRequestSummary = {
  number: number;
  title: string;
  body?: string;
  head: { sha: string };
};

export type PullRequestDetail = {
  number: number;
  title: string;
  body?: string;
  html_url: string;
  head: { sha: string };
  base: { sha: string };
};

export type IssueComment = {
  id: number;
  body?: string;
  issue_url: string;
  html_url?: string;
  user?: { login?: string };
};

export type PullReviewComment = {
  id: number;
  body?: string;
  pull_request_url: string;
  html_url?: string;
  in_reply_to_id?: number;
  user?: { login?: string };
};

export type IssueInfo = {
  number: number;
  pull_request?: unknown;
};

export type PullRequestFile = {
  filename: string;
};
