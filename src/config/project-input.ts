import { normalizeRepoKey } from "../llm/model-routing.js";

export type PrReviewMode = "opened_once" | "on_push";

export function normalizeRepoInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("repo_required");

  let candidate = trimmed;
  if (/^(www\.)?github\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  if (/^https?:\/\//i.test(candidate)) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error("repo_format_invalid");
    }

    if (!/^(www\.)?github\.com$/i.test(parsed.hostname)) {
      throw new Error("repo_format_invalid");
    }

    candidate = parsed.pathname;
  }

  const noGit = candidate.replace(/\.git$/i, "");
  const clean = noGit.replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error("repo_format_invalid");
  }

  return normalizeRepoKey(`${parts[0]}/${parts[1]}`);
}

export function parsePrReviewMode(input: string): PrReviewMode {
  if (input === "opened_once" || input === "on_push") return input;
  throw new Error(`invalid_pr_review_mode:${input}`);
}
