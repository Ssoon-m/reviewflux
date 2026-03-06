import type { PrReviewJobPayload } from "./pr-review-queue.js";

type QueuedReviewRunner = (params: {
  repo: string;
  prNumber: number;
  reason: PrReviewJobPayload["reason"];
}) => Promise<void>;

let cachedRunner: QueuedReviewRunner | null = null;

async function loadQueuedReviewRunner(): Promise<QueuedReviewRunner> {
  if (cachedRunner) return cachedRunner;

  const mod = (await import("../commands/daemon/start.js")) as {
    runQueuedReviewJob?: QueuedReviewRunner;
  };
  if (typeof mod.runQueuedReviewJob !== "function") {
    throw new Error("queued_review_runner_unavailable");
  }
  cachedRunner = mod.runQueuedReviewJob;
  return cachedRunner;
}

export async function processPrReviewJob(
  payload: PrReviewJobPayload,
): Promise<void> {
  const runner = await loadQueuedReviewRunner();
  await runner({
    repo: payload.repo,
    prNumber: payload.prNumber,
    reason: payload.reason,
  });
}
