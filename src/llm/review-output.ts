import { type ReviewFinding } from "../gateway/review-publisher.js";

type StructuredReviewComment = {
  path?: unknown;
  line?: unknown;
  body?: unknown;
};

type StructuredReviewOutput = {
  body?: unknown;
  findings?: unknown;
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

function parseStructuredReviewOutput(raw: string): ReviewFinding[] | null {
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
  const hasFindingsArray =
    hasFindingsField && Array.isArray(parsedObject.findings);
  if (!hasFindingsArray) return null;

  const commentsRaw = normalizeStructuredReviewComments(parsedObject);
  const findings: ReviewFinding[] = [];
  for (const finding of commentsRaw) {
    const pathRaw = typeof finding.path === "string" ? finding.path.trim() : "";
    const line = parseStrictPositiveLine(finding.line);
    const body = typeof finding.body === "string" ? finding.body.trim() : "";
    if (!body) continue;

    const hasLocation = pathRaw.length > 0 && line !== null;
    findings.push({
      path: hasLocation ? pathRaw : "",
      line: hasLocation && line !== null ? line : "",
      body,
    });
  }

  if (commentsRaw.length > 0 && findings.length === 0) return null;

  return findings;
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

function buildNoIssueBody(): string {
  return [
    "🧠 ReviewFlux Review",
    "",
    "Great news - no actionable issues were found in this PR. 👍",
  ].join("\n");
}

function hasNoFindingHint(raw: string): boolean {
  const sanitized = sanitizeModelOutputForFallback(raw).toLowerCase();
  const noFindingHintPattern =
    /^(?:(?:lgtm|looks good to me)\s*[.!-]*\s*)?(?:no\s+actionable\s+issues?(?:\s+found)?|no\s+issues?(?:\s+found)?|no\s+findings?(?:\s+found)?|nothing\s+to\s+review|문제\s*없|이슈\s*없|특이사항\s*없|리뷰할\s*게\s*없|이상\s*없)[.!\s]*$/i;
  return sanitized.length > 0 && noFindingHintPattern.test(sanitized);
}

function buildInvalidFormatFallbackBody(params: {
  raw: string;
  reason: string;
}): string {
  if (hasNoFindingHint(params.raw)) {
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

/**
 * Normalize the raw model response into a single canonical findings array.
 *
 * Each finding keeps the `{ path, line, body }` shape all the way to the posting layer.
 * Unanchored findings use `path: ""` and `line: ""`.
 *
 * @param raw Raw LLM response text.
 * @returns Canonical review findings ready for posting-time classification.
 */
export function resolveReviewOutputFromModel(raw: string): {
  findings: ReviewFinding[];
} {
  const findings = parseStructuredReviewOutput(raw);
  if (!findings) {
    if (hasNoFindingHint(raw)) {
      return { findings: [] };
    }

    return {
      findings: [
        {
          path: "",
          line: "",
          body: buildInvalidFormatFallbackBody({
            raw,
            reason: "invalid model output format (expected structured JSON)",
          }),
        },
      ],
    };
  }

  return { findings };
}
