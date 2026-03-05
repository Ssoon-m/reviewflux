export type InlineReviewComment = {
  path: string;
  line: number;
  body: string;
};

export type PublishReviewContext = {
  repo: string;
  prNumber: number;
  body: string;
  inlineComments?: InlineReviewComment[];
};

export type PublishReviewResult = {
  attemptedInlineCount: number;
  postedInlineCount: number;
  postedSummaryFallback: boolean;
};

export type ReviewPublisherAdapter = {
  listChangedPaths(context: PublishReviewContext): Promise<string[]>;
  postInlineComment(context: PublishReviewContext, comment: InlineReviewComment): Promise<void>;
  postSummaryComment(context: PublishReviewContext, body: string): Promise<void>;
};

export async function publishReviewWithInlineComments(params: {
  context: PublishReviewContext;
  adapter: ReviewPublisherAdapter;
  maxInlineComments?: number;
  postSummaryWhenInlinePosted?: boolean;
  onInlineCommentError?: (comment: InlineReviewComment, error: unknown) => void;
}): Promise<PublishReviewResult> {
  const { context, adapter } = params;
  const parsedInline = context.inlineComments ?? [];
  if (parsedInline.length === 0) {
    await adapter.postSummaryComment(context, context.body);
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedSummaryFallback: true,
    };
  }

  const changedPaths = new Set(await adapter.listChangedPaths(context));
  const maxCount = params.maxInlineComments ?? 20;
  const inline = parsedInline.filter((item) => changedPaths.has(item.path)).slice(0, maxCount);

  if (inline.length === 0) {
    await adapter.postSummaryComment(context, context.body);
    return {
      attemptedInlineCount: 0,
      postedInlineCount: 0,
      postedSummaryFallback: true,
    };
  }

  let postedInlineCount = 0;
  for (const comment of inline) {
    try {
      await adapter.postInlineComment(context, comment);
      postedInlineCount += 1;
    } catch (error) {
      params.onInlineCommentError?.(comment, error);
    }
  }

  if (postedInlineCount === 0) {
    await adapter.postSummaryComment(context, context.body);
    return {
      attemptedInlineCount: inline.length,
      postedInlineCount,
      postedSummaryFallback: true,
    };
  }

  if (params.postSummaryWhenInlinePosted) {
    await adapter.postSummaryComment(context, context.body);
  }
  return {
    attemptedInlineCount: inline.length,
    postedInlineCount,
    postedSummaryFallback: false,
  };
}
