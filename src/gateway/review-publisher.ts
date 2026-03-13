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

export type ReviewDeliveryMode = "inline-with-fallback" | "top-level-only";

export type PublishReviewContext = {
  repo: string;
  prNumber: number;
  findings?: ReviewFinding[];
  deliveryMode?: ReviewDeliveryMode;
};

export type PublishReviewResult = {
  attemptedInlineCount: number;
  postedInlineCount: number;
  postedTopLevelFallback: boolean;
};

export type ReviewPublisherAdapter = {
  listChangedPaths(context: PublishReviewContext): Promise<string[]>;
  postInlineComment(
    context: PublishReviewContext,
    comment: InlineReviewComment,
  ): Promise<void>;
  postSummaryComment(
    context: PublishReviewContext,
    body: string,
  ): Promise<void>;
};

const REVIEW_TITLE = "🧠 ReviewFlux Review";

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

function buildNoIssueBody(): string {
  return "Great news - no actionable issues were found in this PR. 👍";
}

function stripLeadingReviewTitle(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith(REVIEW_TITLE)) return trimmed;

  const remainder = trimmed.slice(REVIEW_TITLE.length);
  return remainder.replace(/^\s+/, "").trim();
}

function buildPostedCommentBody(body: string): string {
  const content = stripLeadingReviewTitle(body);
  const parts = [REVIEW_TITLE];

  if (content.length > 0) {
    parts.push("", content);
  }

  return parts.join("\n").trim();
}

function buildTopLevelCommentBodies(findings: ReviewFinding[]): string[] {
  if (findings.length === 0) {
    return [buildPostedCommentBody(buildNoIssueBody())];
  }

  const blocks = findings
    .map((finding) => stripLeadingReviewTitle(finding.body))
    .filter((body) => body.length > 0);
  if (blocks.length === 0) {
    return [buildPostedCommentBody(buildNoIssueBody())];
  }

  return blocks.map((block) => buildPostedCommentBody(block));
}

async function postTopLevelComments(params: {
  context: PublishReviewContext;
  adapter: ReviewPublisherAdapter;
  findings: ReviewFinding[];
}): Promise<void> {
  const bodies = buildTopLevelCommentBodies(params.findings);
  for (const body of bodies) {
    await params.adapter.postSummaryComment(params.context, body);
  }
}

export async function publishReviewWithInlineComments(params: {
  context: PublishReviewContext;
  adapter: ReviewPublisherAdapter;
  maxInlineComments?: number;
  onInlineCommentError?: (comment: InlineReviewComment, error: unknown) => void;
}): Promise<PublishReviewResult> {
  const { context, adapter } = params;
  const findings = context.findings ?? [];

  if (context.deliveryMode === "top-level-only") {
    await postTopLevelComments({ context, adapter, findings });
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    };
  }

  const parsedInline = findings.filter(isInlineReviewComment);
  const generalFindings = findings.filter(
    (finding) => !isInlineReviewComment(finding),
  );

  if (parsedInline.length === 0) {
    await postTopLevelComments({ context, adapter, findings });
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    };
  }

  const changedPaths = new Set(await adapter.listChangedPaths(context));
  const maxCount = params.maxInlineComments ?? 20;
  const changedPathInline = parsedInline.filter((item) =>
    changedPaths.has(item.path),
  );
  const inline = changedPathInline.slice(0, maxCount);
  const remainingFindings: ReviewFinding[] = [
    ...generalFindings,
    ...parsedInline.filter((item) => !changedPaths.has(item.path)),
    ...changedPathInline.slice(maxCount),
  ];

  if (inline.length === 0) {
    await postTopLevelComments({
      context,
      adapter,
      findings: remainingFindings,
    });
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedTopLevelFallback: true,
    };
  }

  let postedInlineCount = 0;
  const postedInline: InlineReviewComment[] = [];
  for (const comment of inline) {
    try {
      await adapter.postInlineComment(context, {
        ...comment,
        body: buildPostedCommentBody(comment.body),
      });
      postedInlineCount += 1;
      postedInline.push(comment);
    } catch (error) {
      remainingFindings.push(comment);
      params.onInlineCommentError?.(comment, error);
    }
  }

  if (postedInlineCount === 0) {
    await postTopLevelComments({
      context,
      adapter,
      findings: remainingFindings,
    });
    return {
      attemptedInlineCount: inline.length,
      postedInlineCount,
      postedTopLevelFallback: true,
    };
  }

  if (remainingFindings.length > 0) {
    await postTopLevelComments({
      context,
      adapter,
      findings: remainingFindings,
    });
    return {
      attemptedInlineCount: inline.length,
      postedInlineCount,
      postedTopLevelFallback: true,
    };
  }

  return {
    attemptedInlineCount: inline.length,
    postedInlineCount,
    postedTopLevelFallback: false,
  };
}
