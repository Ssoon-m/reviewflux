import { stripReviewCommentTitle } from "../contracts/review-comment-format.js";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractSection(body: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escapedHeading}\\s*([\\s\\S]*?)(?=\\n###\\s|$)`,
    "i",
  );
  return body.match(pattern)?.[1]?.trim() ?? "";
}

function extractDetailLines(findingsSection: string): string[] {
  return findingsSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s*detail\s*:/i.test(line))
    .map(normalizeText)
    .filter((line) => line.length > 0);
}

export function createFindingFingerprint(body: string): string {
  const content = stripReviewCommentTitle(body);
  if (!content) return "";

  const summary = normalizeText(extractSection(content, "### Summary"));
  const detailLines = extractDetailLines(
    extractSection(content, "### Findings (ordered by severity)"),
  );

  if (summary || detailLines.length > 0) {
    return [summary, ...detailLines].filter((part) => part.length > 0).join("|");
  }

  return normalizeText(content);
}
