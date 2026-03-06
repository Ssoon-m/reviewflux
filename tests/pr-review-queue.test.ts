import { setTimeout as wait } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  createPrReviewQueue,
  type PrReviewJobPayload,
} from "../src/gateway/pr-review-queue.js";

function makePayload(): PrReviewJobPayload {
  return {
    eventName: "pull_request",
    repo: "ssoon-m/reviewflux",
    action: "synchronize",
    commentBody: undefined,
    prNumber: 11,
    reason: "on_push",
    force: false,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 300,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error("wait_for_timeout");
}

describe("createPrReviewQueue", () => {
  it("records terminal failures for observability", async () => {
    const queue = createPrReviewQueue({
      concurrency: 1,
      retryCount: 1,
      retryDelayMs: 1,
      processJob: async () => {
        throw new Error("boom");
      },
    });

    const jobId = queue.enqueue(makePayload());

    await waitFor(() => queue.getRecentFailures().length === 1);
    const failures = queue.getRecentFailures();
    expect(failures[0]?.jobId).toBe(jobId);
    expect(failures[0]?.attempt).toBe(2);
    expect(failures[0]?.errorMessage).toContain("boom");
    expect(failures[0]?.payload.repo).toBe("ssoon-m/reviewflux");
  });

  it("does not record failure when retry succeeds", async () => {
    let attempts = 0;
    const queue = createPrReviewQueue({
      concurrency: 1,
      retryCount: 1,
      retryDelayMs: 1,
      processJob: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("first attempt fails");
        }
      },
    });

    queue.enqueue(makePayload());
    await waitFor(() => attempts >= 2);
    await wait(20);

    expect(queue.getRecentFailures()).toEqual([]);
  });
});
