export type ReviewFinding = {
  path: string;
  line: number | "";
  body: string;
};

export type InlineReviewComment = {
  path: string;
  line: number;
  body: string;
};

export type PublishReviewContext = {
  repo: string;
  prNumber: number;
  findings?: ReviewFinding[];
  summaryPrefix?: string;
};

export type PublishReviewResult = {
  attemptedInlineCount: number;
  postedInlineCount: number;
  postedSummaryFallback: boolean;
};

export type ReviewPublisherAdapter = {
  listChangedPaths(context: PublishReviewContext): Promise<string[]>;
  postInlineComment(
    context: PublishReviewContext,
    comment: InlineReviewComment,
  ): Promise<void>;
  postSummaryComment(context: PublishReviewContext, body: string): Promise<void>;
};

function isInlineReviewComment(
  finding: ReviewFinding,
): finding is InlineReviewComment {
  return (
    finding.path.length > 0 &&
    typeof finding.line === "number" &&
    Number.isInteger(finding.line) &&
    finding.line > 0
  );
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

function buildBodyFromGeneralFindings(findings: ReviewFinding[]): string {
  const top = findings
    .slice(0, 3)
    .map((finding) => extractFindingDigest(finding.body, 220))
    .filter((item) => item.length > 0);

  const renderedFindings =
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
    renderedFindings,
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
    "Great news - no actionable issues were found in this PR. 👍",
  ].join("\n");
}

function applySummaryPrefix(body: string, summaryPrefix?: string): string {
  const prefix = summaryPrefix?.trim();
  if (!prefix) return body;
  if (body.includes("### Summary\n")) {
    return body.replace("### Summary\n", `### Summary\n${prefix}\n\n`);
  }
  if (body.startsWith("🧠 ReviewFlux Review\n\n")) {
    return body.replace(
      "🧠 ReviewFlux Review\n\n",
      `🧠 ReviewFlux Review\n\n${prefix}\n\n`,
    );
  }
  return `${prefix}\n\n${body}`;
}

function resolveDirectStructuredSummaryBody(findings: ReviewFinding[]): string | null {
  if (findings.length !== 1) return null;

  const [finding] = findings;
  if (finding.path.length > 0 || finding.line !== "") return null;
  return isStrictReviewBody(finding.body) ? finding.body : null;
}

function buildFallbackSummaryBody(
  findings: ReviewFinding[],
  summaryPrefix?: string,
): string {
  if (findings.length === 0) {
    return applySummaryPrefix(buildNoIssueBody(), summaryPrefix);
  }

  const directStructuredBody = resolveDirectStructuredSummaryBody(findings);
  if (directStructuredBody) {
    return applySummaryPrefix(directStructuredBody, summaryPrefix);
  }

  return applySummaryPrefix(buildBodyFromGeneralFindings(findings), summaryPrefix);
}

function buildInlinePostedSummaryBody(
  findings: ReviewFinding[],
  summaryPrefix?: string,
): string {
  const inlineComments = findings.filter(isInlineReviewComment);
  if (inlineComments.length === 0) {
    return buildFallbackSummaryBody(findings, summaryPrefix);
  }

  return applySummaryPrefix(
    buildBodyFromInlineComments(inlineComments),
    summaryPrefix,
  );
}

function buildSummaryFromRemainingFindings(
  findings: ReviewFinding[],
  summaryPrefix?: string,
): string {
  return buildFallbackSummaryBody(findings, summaryPrefix);
}

export async function publishReviewWithInlineComments(params: {
  context: PublishReviewContext;
  adapter: ReviewPublisherAdapter;
  maxInlineComments?: number;
  postSummaryWhenInlinePosted?: boolean;
  onInlineCommentError?: (comment: InlineReviewComment, error: unknown) => void;
}): Promise<PublishReviewResult> {
  const { context, adapter } = params;
  const findings = context.findings ?? [];
  const parsedInline = findings.filter(isInlineReviewComment);
  const generalFindings = findings.filter((finding) => !isInlineReviewComment(finding));

  if (parsedInline.length === 0) {
    await adapter.postSummaryComment(
      context,
      buildSummaryFromRemainingFindings(findings, context.summaryPrefix),
    );
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedSummaryFallback: true,
    };
  }

  const changedPaths = new Set(await adapter.listChangedPaths(context));
  const maxCount = params.maxInlineComments ?? 20;
  const changedPathInline = parsedInline.filter((item) => changedPaths.has(item.path));
  const inline = changedPathInline.slice(0, maxCount);
  const remainingFindings: ReviewFinding[] = [
    ...generalFindings,
    ...parsedInline.filter((item) => !changedPaths.has(item.path)),
    ...changedPathInline.slice(maxCount),
  ];

  if (inline.length === 0) {
    await adapter.postSummaryComment(
      context,
      buildSummaryFromRemainingFindings(remainingFindings, context.summaryPrefix),
    );
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedSummaryFallback: true,
    };
  }

  let postedInlineCount = 0;
  const postedInline: InlineReviewComment[] = [];
  for (const comment of inline) {
    try {
      await adapter.postInlineComment(context, comment);
      postedInlineCount += 1;
      postedInline.push(comment);
    } catch (error) {
      remainingFindings.push(comment);
      params.onInlineCommentError?.(comment, error);
    }
  }

  if (postedInlineCount === 0) {
    await adapter.postSummaryComment(
      context,
      buildSummaryFromRemainingFindings(remainingFindings, context.summaryPrefix),
    );
    return {
      attemptedInlineCount: inline.length,
      postedInlineCount,
      postedSummaryFallback: true,
    };
  }

  if (remainingFindings.length > 0) {
    await adapter.postSummaryComment(
      context,
      buildSummaryFromRemainingFindings(remainingFindings, context.summaryPrefix),
    );
    return {
      attemptedInlineCount: inline.length,
      postedInlineCount,
      postedSummaryFallback: true,
    };
  }

  if (params.postSummaryWhenInlinePosted) {
    const inlineSummaryBody = buildInlinePostedSummaryBody(
      postedInline,
      context.summaryPrefix,
    );
    await adapter.postSummaryComment(context, inlineSummaryBody);
  }
  return {
    attemptedInlineCount: inline.length,
    postedInlineCount,
    postedSummaryFallback: false,
  };
}
