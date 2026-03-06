import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "../config/env.js";
import { loadConfig } from "../cli/config.js";
import { decidePrReview } from "./pr-event-policy.js";
import { createLlmService } from "../llm/service.js";
import { createPrReviewQueue } from "./pr-review-queue.js";
import { normalizeRepoKey } from "../llm/model-routing.js";
import { processPrReviewJob } from "./review-job-runner.js";

const EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const EVENT_DEDUPE_MAX_KEYS = 5000;
const COLLABORATOR_AUTHOR_ASSOCIATIONS = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);

export function parsePromptText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStrictPositiveInteger(value: unknown): number | null {
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

export function parsePrNumber(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as {
    prNumber?: unknown;
    pull_request?: { number?: unknown };
    issue?: { number?: unknown };
  };

  const direct = parseStrictPositiveInteger(candidate.prNumber);
  if (direct !== null) return direct;

  const prNested = parseStrictPositiveInteger(candidate.pull_request?.number);
  if (prNested !== null) return prNested;

  const issueNested = parseStrictPositiveInteger(candidate.issue?.number);
  if (issueNested !== null) return issueNested;

  return null;
}

function parsePrHeadSha(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as {
    pull_request?: { head?: { sha?: unknown } };
    prHeadSha?: unknown;
  };
  const direct =
    typeof candidate.prHeadSha === "string" ? candidate.prHeadSha.trim() : "";
  if (direct) return direct;
  const nested =
    typeof candidate.pull_request?.head?.sha === "string"
      ? candidate.pull_request.head.sha.trim()
      : "";
  return nested || null;
}

function parseCommentId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as {
    comment?: { id?: unknown };
    commentId?: unknown;
  };

  const direct = candidate.commentId;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return String(Math.trunc(direct));
  }
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nested = candidate.comment?.id;
  if (typeof nested === "number" && Number.isFinite(nested)) {
    return String(Math.trunc(nested));
  }
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }

  return null;
}

function parseHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmed = item.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function parseAssociationValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function parseEventActorAssociation(input: {
  eventName: "pull_request" | "issue_comment" | "pull_request_review_comment";
  payload: unknown;
}): string | null {
  if (!input.payload || typeof input.payload !== "object") return null;
  const candidate = input.payload as {
    author_association?: unknown;
    authorAssociation?: unknown;
    pull_request?: { author_association?: unknown };
    comment?: { author_association?: unknown };
  };

  if (input.eventName === "pull_request") {
    return (
      parseAssociationValue(candidate.pull_request?.author_association) ??
      parseAssociationValue(candidate.author_association) ??
      parseAssociationValue(candidate.authorAssociation)
    );
  }

  return (
    parseAssociationValue(candidate.comment?.author_association) ??
    parseAssociationValue(candidate.author_association) ??
    parseAssociationValue(candidate.authorAssociation)
  );
}

export function isCollaboratorAssociation(value: string | null): boolean {
  if (!value) return false;
  return COLLABORATOR_AUTHOR_ASSOCIATIONS.has(value);
}

export function buildReviewEventDedupeKey(input: {
  deliveryId: string | null;
  eventName: "pull_request" | "issue_comment" | "pull_request_review_comment";
  repo: string;
  action?: string;
  prNumber: number;
  reason: "manual_force" | "opened_once" | "on_push";
  prHeadSha: string | null;
  commentId: string | null;
}): string | null {
  if (input.deliveryId) return `delivery:${input.deliveryId}`;

  const repoKey = normalizeRepoKey(input.repo);
  if (input.eventName === "pull_request") {
    if (!input.prHeadSha) return null;
    return [
      "pr",
      repoKey,
      String(input.prNumber),
      input.prHeadSha,
      input.action?.trim().toLowerCase() || "",
      input.reason,
    ].join(":");
  }

  if (input.commentId) {
    return [
      "comment",
      repoKey,
      String(input.prNumber),
      input.eventName,
      input.commentId,
      input.reason,
    ].join(":");
  }

  return null;
}

export function markRecentEventKey(
  cache: Map<string, number>,
  key: string,
  now: number,
): boolean {
  for (const [cachedKey, ts] of cache.entries()) {
    if (now - ts > EVENT_DEDUPE_TTL_MS) {
      cache.delete(cachedKey);
    }
  }

  const existing = cache.get(key);
  if (typeof existing === "number" && now - existing <= EVENT_DEDUPE_TTL_MS) {
    return true;
  }

  cache.set(key, now);
  while (cache.size > EVENT_DEDUPE_MAX_KEYS) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return false;
}

export function getClientErrorCode(_error: unknown): string {
  return "internal_error";
}

export function createApp() {
  const config = readConfig();
  let llm = null as ReturnType<typeof createLlmService> | null;
  const recentReviewEventKeys = new Map<string, number>();
  const reviewQueue = createPrReviewQueue({
    concurrency: config.EVENT_QUEUE_CONCURRENCY,
    retryCount: config.EVENT_QUEUE_RETRY_COUNT,
    retryDelayMs: config.EVENT_QUEUE_RETRY_DELAY_MS,
    processJob: processPrReviewJob,
  });

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, queueRecentFailures: reviewQueue.getRecentFailures().length });
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

      const prNumber = parsePrNumber(req.body);
      if (!prNumber) {
        return res.status(400).json({ error: "pr_number_required_for_review_event" });
      }

      if (
        decision.reason !== "manual_force" &&
        decision.reason !== "opened_once" &&
        decision.reason !== "on_push"
      ) {
        return res.status(500).json({ error: "invalid_review_reason" });
      }

      const actorAssociation = parseEventActorAssociation({
        eventName,
        payload: req.body,
      });
      if (!isCollaboratorAssociation(actorAssociation)) {
        return res.status(202).json({
          accepted: false,
          blocked: "non_collaborator_trigger",
          decision,
        });
      }

      const dedupeKey = buildReviewEventDedupeKey({
        deliveryId: parseHeaderValue(req.headers["x-github-delivery"]),
        eventName,
        repo,
        action: event.action,
        prNumber,
        reason: decision.reason,
        prHeadSha: parsePrHeadSha(req.body),
        commentId: parseCommentId(req.body),
      });
      if (
        dedupeKey &&
        markRecentEventKey(recentReviewEventKeys, dedupeKey, Date.now())
      ) {
        return res
          .status(202)
          .json({ accepted: false, deduplicated: true, decision });
      }

      const jobId = reviewQueue.enqueue({
        ...event,
        prNumber,
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
