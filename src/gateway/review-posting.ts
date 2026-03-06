import {
  publishReviewWithInlineComments,
  type InlineReviewComment,
  type PublishReviewContext,
  type ReviewPublisherAdapter,
} from "./review-publisher.js";

type DiffLineIndex = Map<string, number[]>;

type PullRequestFile = {
  filename: string;
};

function parseCommentableRightSideLinesFromDiff(diff: string): DiffLineIndex {
  const index: DiffLineIndex = new Map();
  let currentPath: string | null = null;
  let newLine = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      if (line === "+++ /dev/null") {
        currentPath = null;
        inHunk = false;
        continue;
      }
      const nextPath = line.replace("+++ b/", "").trim();
      currentPath = nextPath;
      if (!index.has(nextPath)) index.set(nextPath, []);
      inHunk = false;
      continue;
    }

    const hunkHeader = line.match(
      /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
    );
    if (hunkHeader) {
      newLine = Number.parseInt(hunkHeader[1] ?? "0", 10);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentPath) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;

    const marker = line[0] ?? "";
    if (marker === " " || marker === "+") {
      const entry = index.get(currentPath);
      if (entry) entry.push(newLine);
      newLine += 1;
      continue;
    }

    if (marker === "-") {
      continue;
    }

    inHunk = false;
  }

  return index;
}

function resolveClosestCommentableLine(
  lineIndex: DiffLineIndex,
  path: string,
  requestedLine: number,
): number | null {
  if (!Number.isFinite(requestedLine) || requestedLine <= 0) return null;

  const lines = lineIndex.get(path);
  if (!lines || lines.length === 0) return null;
  if (lines.includes(requestedLine)) return requestedLine;
  return null;
}

export async function postReviewOutput(params: {
  repo: string;
  prNumber: number;
  prHeadSha: string;
  body: string;
  diff: string;
  inlineComments?: InlineReviewComment[];
  listPullRequestFiles: (
    repo: string,
    prNumber: number,
  ) => Promise<PullRequestFile[]>;
  postReviewComment: (
    repo: string,
    prNumber: number,
    body: string,
  ) => Promise<void>;
  postInlineReviewComment: (args: {
    repo: string;
    prNumber: number;
    prHeadSha: string;
    comment: InlineReviewComment;
  }) => Promise<void>;
}): Promise<void> {
  const lineIndex = parseCommentableRightSideLinesFromDiff(params.diff);

  const context: PublishReviewContext = {
    repo: params.repo,
    prNumber: params.prNumber,
    body: params.body,
    inlineComments: params.inlineComments,
  };

  const adapter: ReviewPublisherAdapter = {
    listChangedPaths: async ({ repo, prNumber }) => {
      const files = await params.listPullRequestFiles(repo, prNumber);
      return files.map((file) => file.filename);
    },
    postInlineComment: async (
      { repo, prNumber },
      comment: InlineReviewComment,
    ) => {
      const line = resolveClosestCommentableLine(
        lineIndex,
        comment.path,
        comment.line,
      );
      if (!line) {
        throw new Error(
          `no_commentable_line_in_diff:${comment.path}:${comment.line}`,
        );
      }

      const resolvedComment: InlineReviewComment = {
        ...comment,
        line,
      };
      await params.postInlineReviewComment({
        repo,
        prNumber,
        prHeadSha: params.prHeadSha,
        comment: resolvedComment,
      });
    },
    postSummaryComment: async ({ repo, prNumber }, body) =>
      params.postReviewComment(repo, prNumber, body),
  };

  await publishReviewWithInlineComments({
    context,
    adapter,
    maxInlineComments: 20,
    postSummaryWhenInlinePosted: false,
    onInlineCommentError: (comment, error) => {
      console.error(
        `[reviewflux] failed to post inline comment: ${comment.path}:${comment.line}`,
      );
      console.error(error instanceof Error ? error.message : String(error));
    },
  });
}
