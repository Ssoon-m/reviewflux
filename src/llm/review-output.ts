import { type InlineReviewComment } from "../gateway/review-publisher.js";

type StructuredReviewComment = {
  path?: unknown;
  line?: unknown;
  body?: unknown;
};

type StructuredReviewOutput = {
  body?: unknown;
  findings?: unknown;
};

type ParsedStructuredReview = {
  body: string | null;
  inlineComments: InlineReviewComment[];
  findingBodies: string[];
};

function extractJsonPayload(raw: string): string | null {
  const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fencedJson) return fencedJson;

  const fencedAny = raw.match(/```\s*([\s\S]*?)```/)?.[1]?.trim();
  if (fencedAny && (fencedAny.startsWith("{") || fencedAny.startsWith("["))) {
    return fencedAny;
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return raw.slice(firstBracket, lastBracket + 1).trim();
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
}

function normalizeStructuredReviewComments(
  parsedObject: StructuredReviewOutput,
): StructuredReviewComment[] {
  if (Array.isArray(parsedObject.findings)) {
    return parsedObject.findings as StructuredReviewComment[];
  }
  return [];
}

function parseStrictPositiveLine(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseStructuredReviewOutput(raw: string): ParsedStructuredReview | null {
  const payload = extractJsonPayload(raw);
  if (!payload) return null;

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(payload);
  } catch {
    return null;
  }

  const parsedObject: StructuredReviewOutput =
    parsedValue &&
    typeof parsedValue === "object" &&
    !Array.isArray(parsedValue)
      ? (parsedValue as StructuredReviewOutput)
      : {};

  const hasFindingsField = Object.prototype.hasOwnProperty.call(
    parsedObject,
    "findings",
  );
  const hasFindingsArray = hasFindingsField && Array.isArray(parsedObject.findings);
  if (!hasFindingsArray) return null;

  const bodyFromModel =
    typeof parsedObject.body === "string" ? parsedObject.body.trim() : "";

  const commentsRaw = normalizeStructuredReviewComments(parsedObject);
  const inlineComments: InlineReviewComment[] = [];
  const findingBodies: string[] = [];
  for (const finding of commentsRaw) {
    const pathRaw = typeof finding.path === "string" ? finding.path.trim() : "";
    const line = parseStrictPositiveLine(finding.line);
    const body = typeof finding.body === "string" ? finding.body.trim() : "";
    if (!body) continue;
    findingBodies.push(body);
    const hasLocation = pathRaw.length > 0 && line !== null;

    if (!hasLocation || line === null) continue;
    inlineComments.push({
      path: pathRaw,
      line,
      body,
    });
  }

  return { body: bodyFromModel || null, inlineComments, findingBodies };
}

function buildBodyFromInlineComments(inlineComments: InlineReviewComment[]): string {
  const top = inlineComments.slice(0, 3).map((item) => {
    const compact = extractFindingDigest(item.body, 180);
    const short = compact.length > 0 ? compact : "Line-level finding";
    return `${item.path}:${item.line} ${short}`;
  });

  const findings =
    top.length > 0
      ? top.map((item) => `- ${item}`).join("\n")
      : "- Line-specific findings were detected; see inline comments for details.";

  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    "Potential issues were detected from structured findings.",
    "",
    "### Findings (ordered by severity)",
    findings,
    "",
    "### Verification Notes",
    "- Verified: Parsed structured findings (path/line/body) from model output.",
    "- Not Verified: Model-provided top-level body format.",
  ].join("\n");
}

function extractSummaryFromStrictReviewBody(body: string): string | null {
  const trimmed = body.trim();
  if (!isStrictReviewBody(trimmed)) return null;

  const summaryMatch = trimmed.match(/### Summary\s*\n([\s\S]*?)(?:\n###\s|$)/);
  const summary = summaryMatch?.[1]?.replace(/\s+/g, " ").trim();
  return summary || null;
}

function extractFindingDigest(body: string, maxChars: number): string {
  const fromStrictSummary = extractSummaryFromStrictReviewBody(body);
  const compact = (fromStrictSummary ?? body).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxChars
    ? `${compact.slice(0, Math.max(0, maxChars - 3))}...`
    : compact;
}

function buildBodyFromGeneralFindings(findingBodies: string[]): string {
  const top = findingBodies
    .slice(0, 3)
    .map((body) => extractFindingDigest(body, 220))
    .filter((item) => item.length > 0);

  const findings =
    top.length > 0
      ? top.map((item) => `- ${item}`).join("\n")
      : "- General findings were reported, but no summary details were extracted.";

  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    "Potential issues were reported from structured findings.",
    "",
    "### Findings (ordered by severity)",
    findings,
    "",
    "### Verification Notes",
    "- Verified: Parsed structured finding bodies from model output.",
    "- Not Verified: Exact inline path/line anchors were not available.",
  ].join("\n");
}

function buildNoIssueBody(): string {
  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    "Great news - no actionable issues were found in this PR.",
    "",
    "### Verification Notes",
    "- Verified: Structured review completed without findings.",
    "- Not Verified: Runtime behavior beyond static/diff-level review.",
  ].join("\n");
}

function isStrictReviewBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("🧠 ReviewFlux Review\n\n### Summary")) return false;

  const summaryIndex = trimmed.indexOf("\n### Summary");
  const findingsIndex = trimmed.indexOf("\n### Findings");
  const verificationIndex = trimmed.indexOf("\n### Verification Notes");
  if (summaryIndex < 0 || verificationIndex < 0) return false;
  if (findingsIndex >= 0) {
    return summaryIndex < findingsIndex && findingsIndex < verificationIndex;
  }
  return summaryIndex < verificationIndex;
}

function sanitizeModelOutputForFallback(raw: string): string {
  const source = resolveFallbackSourceText(raw);
  return source
    .replace(/```json/gi, " ")
    .replace(/```/g, " ")
    .replace(/[{}\[\]"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveFallbackSourceText(raw: string): string {
  const payload = extractJsonPayload(raw);
  if (!payload) {
    const looseFromRaw = extractLooseBodyText(raw);
    return looseFromRaw ?? raw;
  }

  try {
    const parsed = JSON.parse(payload) as {
      body?: unknown;
      findings?: unknown;
    };

    if (typeof parsed.body === "string" && parsed.body.trim().length > 0) {
      return parsed.body.trim();
    }

    if (Array.isArray(parsed.findings)) {
      const findingBodies = parsed.findings
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const finding = item as { body?: unknown };
          return typeof finding.body === "string" ? finding.body.trim() : "";
        })
        .filter((text) => text.length > 0);
      if (findingBodies.length > 0) {
        return findingBodies.join("\n");
      }
    }
  } catch {
    const looseFromPayload = extractLooseBodyText(payload);
    return looseFromPayload ?? payload;
  }

  const looseFromPayload = extractLooseBodyText(payload);
  return looseFromPayload ?? payload;
}

function extractLooseBodyText(input: string): string | null {
  const bodyMatch = input.match(
    /["']?body["']?\s*:\s*([\s\S]*?)(?:,\s*["']?findings["']?\s*:|\}\s*$|$)/i,
  );
  if (!bodyMatch?.[1]) return null;

  const rawValue = bodyMatch[1].trim();
  if (!rawValue) return null;

  const unwrapped = rawValue.replace(/^["']|["']$/g, "").trim();
  return unwrapped
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function buildBestEffortFallbackBody(params: { raw: string; reason: string }): string {
  const sanitized = sanitizeModelOutputForFallback(params.raw).toLowerCase();
  const noFindingHintPattern =
    /(\bno\s+actionable\s+issues?\b|\bno\s+issues?\b|\bno\s+findings?\b|\bnothing\s+to\s+review\b|\blgtm\b|문제\s*없|이슈\s*없|특이사항\s*없|리뷰할\s*게\s*없|이상\s*없)/i;
  if (sanitized.length > 0 && noFindingHintPattern.test(sanitized)) {
    return buildNoIssueBody();
  }

  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    "Review completed, but the model output format was invalid. Detailed findings are skipped for this run.",
    "",
    "### Verification Notes",
    "- Verified: Review request executed.",
    `- Not Verified: ${params.reason}`,
  ].join("\n");
}

export function resolveReviewOutputFromModel(raw: string): {
  body: string;
  inlineComments: InlineReviewComment[];
} {
  const structured = parseStructuredReviewOutput(raw);
  if (!structured) {
    return {
      body: buildBestEffortFallbackBody({
        raw,
        reason: "invalid model output format (expected structured JSON)",
      }),
      inlineComments: [],
    };
  }

  if (structured.inlineComments.length > 0) {
    return {
      body: buildBodyFromInlineComments(structured.inlineComments),
      inlineComments: structured.inlineComments,
    };
  }

  if (structured.findingBodies.length > 0) {
    return {
      body: buildBodyFromGeneralFindings(structured.findingBodies),
      inlineComments: [],
    };
  }

  return {
    body: buildNoIssueBody(),
    inlineComments: [],
  };
}
