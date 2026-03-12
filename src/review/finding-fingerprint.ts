const REVIEW_TITLE = "🧠 ReviewFlux Review";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripReviewTitle(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith(REVIEW_TITLE)) return trimmed;

  const remainder = trimmed.slice(REVIEW_TITLE.length);
  return remainder.replace(/^\s+/, "").trim();
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
  const content = stripReviewTitle(body);
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
