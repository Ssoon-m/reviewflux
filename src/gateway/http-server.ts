import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "../config/env.js";
import { loadConfig } from "../cli/config.js";
import { decidePrReview } from "./pr-event-policy.js";
import { createLlmService } from "../llm/service.js";
import { createPrReviewQueue, type PrReviewJobPayload } from "./pr-review-queue.js";

export function parsePromptText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getClientErrorCode(_error: unknown): string {
  return "internal_error";
}

export function createApp() {
  const config = readConfig();
  let llm = null as ReturnType<typeof createLlmService> | null;
  const reviewQueue = createPrReviewQueue({
    concurrency: config.EVENT_QUEUE_CONCURRENCY,
    retryCount: config.EVENT_QUEUE_RETRY_COUNT,
    retryDelayMs: config.EVENT_QUEUE_RETRY_DELAY_MS,
    processJob: processPrReviewJob,
  });

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/v1/ask", async (req, res) => {
    try {
      const prompt = parsePromptText(req.body?.text);
      if (!prompt) return res.status(400).json({ error: "text_must_be_non_empty_string" });

      if (!llm) {
        llm = createLlmService(config);
      }

      const answer = await llm.generateReply([
        { role: "system", content: "You are an assistant for issue-flow-ai." },
        { role: "user", content: prompt }
      ]);

      res.json({ answer });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("/v1/ask failed", error);
      res.status(500).json({ error: getClientErrorCode(error) });
    }
  });

  app.post("/v1/github/events", (req, res) => {
    try {
      const eventName = req.body?.eventName;
      const repo = req.body?.repo;

      if (
        (eventName !== "pull_request" &&
          eventName !== "issue_comment" &&
          eventName !== "pull_request_review_comment") ||
        typeof repo !== "string" ||
        repo.trim().length === 0
      ) {
        return res.status(400).json({ error: "invalid_event_payload" });
      }

      const config = loadConfig();
      const event = {
        eventName,
        repo,
        action: typeof req.body?.action === "string" ? req.body.action : undefined,
        commentBody: typeof req.body?.commentBody === "string" ? req.body.commentBody : undefined,
      };
      const decision = decidePrReview(config, event);

      if (!decision.shouldReview) {
        return res.json({ accepted: false, decision });
      }

      const jobId = reviewQueue.enqueue({
        ...event,
        reason: decision.reason,
        force: decision.force,
      });

      res.status(202).json({ accepted: true, jobId, decision });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("/v1/github/events failed", error);
      res.status(500).json({ error: getClientErrorCode(error) });
    }
  });

  return { app, config };
}

async function processPrReviewJob(payload: PrReviewJobPayload): Promise<void> {
  console.log(
    `[reviewflux] review job processed repo=${payload.repo} event=${payload.eventName} reason=${payload.reason} force=${payload.force}`,
  );
}

function canonicalPath(pathLike: string): string {
  try {
    return realpathSync(pathLike);
  } catch {
    return resolve(pathLike);
  }
}

export function isDirectRun(metaUrl: string, argv1?: string): boolean {
  if (!argv1) return false;
  return canonicalPath(fileURLToPath(metaUrl)) === canonicalPath(argv1);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const { app, config } = createApp();
  app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`issue-flow-ai server listening on :${config.PORT}`);
  });
}
