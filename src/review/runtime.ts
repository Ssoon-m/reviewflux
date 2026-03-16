import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getModel } from "@mariozechner/pi-ai";
import { apiKeyFromPiOAuth, refreshWithPiOAuth } from "../auth/pi-oauth.js";
import {
  getActiveAuthProfile,
  loadConfig,
  type ReviewFluxConfig,
  saveConfig,
} from "../cli/config.js";
import {
  createPostedReviewKey,
  hasPostedReviewKey,
} from "../gateway/review-key.js";
import { postReviewOutput } from "../gateway/review-posting.js";
import type { ReviewFinding } from "../gateway/review-publisher.js";
import { logging } from "../infra/logging/index.js";
import { createLlmProvider } from "../llm/factory.js";
import { resolveCodexEffort } from "../llm/reasoning-effort.js";
import { resolveReviewOutputFromModel } from "../llm/review-output.js";
import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
} from "../llm/review-prompt.js";
import { normalizeRepoKey } from "../lib/repo/input.js";
import { createFindingFingerprint } from "./finding-fingerprint.js";
import {
  buildRemoteProjectContextText,
  fetchPullRequestDetail,
  ghExec,
  listPullRequestFiles,
  listPullRequestIssueComments,
  listPullRequestReviewComments,
  postInlineReviewComment,
  postPullRequestComment,
  postPullRequestReviewReply,
} from "./github.js";
import {
  buildHandledManualTriggerKey,
  canReplyInReviewThread,
  type ManualReviewTrigger,
} from "./manual-trigger.js";
import {
  buildProjectReviewState,
  hasHandledManualTriggerKey,
  loadReviewState,
  type ReviewState,
  saveReviewState,
  trackHandledManualTriggerKey,
  trackPostedReviewKey,
} from "./state-store.js";
import type {
  ProjectConfig,
  PullRequestDetail,
  ReviewTriggerReason,
} from "./types.js";

const REVIEW_TITLE = "🧠 ReviewFlux Review";
const MAX_GLOBAL_AGENTS_CHARS = 6000;
const MAX_BASE_POLICY_CHARS = 6000;
const BASE_POLICY_FILE = "REVIEWFLUX-AGENTS.md";
const REVIEW_CONTEXT_LOAD_FAILED_ERROR = "project_context_load_failed";

const inFlightReviewKeys = new Set<string>();

type ReviewRuntimeLogEvent =
  | "review_skipped_already_posted"
  | "review_skipped_manual_trigger_handled"
  | "review_skipped_in_flight_duplicate"
  | "review_context_load_failed"
  | "review_skipped_no_new_findings"
  | "review_manual_no_new_findings_response"
  | "review_posted";

function logReviewRuntimeEvent(input: {
  level: "info" | "warn" | "error";
  event: ReviewRuntimeLogEvent;
  message: string;
  context?: Record<string, unknown>;
}): void {
  logging({
    surface: "review-runtime",
    type: "review",
    level: input.level,
    event: input.event,
    message: input.message,
    context: input.context,
  });
}

function globalAgentsPath(home: string = homedir()): string {
  return join(home, ".reviewflux", "AGENTS.md");
}

function loadBasePolicyGuidance(): string {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(process.cwd(), "src", "commands", "setup", BASE_POLICY_FILE),
    join(process.cwd(), BASE_POLICY_FILE),
    join(moduleDir, "..", "commands", "setup", BASE_POLICY_FILE),
    join(moduleDir, "..", "..", "src", "commands", "setup", BASE_POLICY_FILE),
    join(moduleDir, "..", BASE_POLICY_FILE),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8").trim();
      if (content) return content.slice(0, MAX_BASE_POLICY_CHARS);
    } catch {}
  }

  return "";
}

function loadGlobalAgentsGuidance(home: string = homedir()): string {
  const path = globalAgentsPath(home);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8").slice(0, MAX_GLOBAL_AGENTS_CHARS).trim();
  } catch {
    return "";
  }
}

function isAutomaticReviewReason(reason: ReviewTriggerReason): boolean {
  return reason === "opened_once" || reason === "on_push";
}

function buildPostedReviewBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return REVIEW_TITLE;
  if (trimmed.startsWith(REVIEW_TITLE)) return trimmed;
  return `${REVIEW_TITLE}\n\n${trimmed}`;
}

function buildNoNewFindingBody(): string {
  return buildPostedReviewBody(
    [
      "### Summary",
      "Review completed, and no new issues beyond existing ReviewFlux findings were identified for this PR state.",
      "",
      "### Verification Notes",
      "- Verified: manual review request executed.",
      "- Verified: equivalent ReviewFlux findings already exist on this pull request.",
    ].join("\n"),
  );
}

function buildIssueCommentFollowUpBody(
  body: string,
  trigger: ManualReviewTrigger | undefined,
): string {
  if (!trigger || trigger.eventName !== "issue_comment") return body;

  const contextParts = [
    trigger.senderLogin ? `@${trigger.senderLogin}` : "",
    trigger.commentUrl ? `[trigger comment](${trigger.commentUrl})` : "",
  ].filter((part) => part.length > 0);

  if (contextParts.length === 0) return body;
  return `${contextParts.join(" ")}\n\n${body}`;
}

async function loadExistingFindingFingerprints(
  repo: string,
  prNumber: number,
): Promise<Set<string>> {
  const [issueComments, reviewComments] = await Promise.all([
    listPullRequestIssueComments(repo, prNumber),
    listPullRequestReviewComments(repo, prNumber),
  ]);
  const fingerprints = new Set<string>();

  for (const comment of [...issueComments, ...reviewComments]) {
    const body = typeof comment.body === "string" ? comment.body : "";
    if (!body.includes(REVIEW_TITLE)) continue;
    const fingerprint = createFindingFingerprint(body);
    if (fingerprint.length > 0) {
      fingerprints.add(fingerprint);
    }
  }

  return fingerprints;
}

function filterAlreadyPostedFindings(params: {
  findings: ReviewFinding[];
  existingFingerprints: Set<string>;
}): ReviewFinding[] {
  return params.findings.filter((finding) => {
    const fingerprint = createFindingFingerprint(finding.body);
    return (
      fingerprint.length === 0 || !params.existingFingerprints.has(fingerprint)
    );
  });
}

function resolveProjectModel(
  config: ReviewFluxConfig,
  project: ProjectConfig,
): { provider: string; model: string } {
  if (project.model?.provider && project.model.model) {
    return {
      provider: project.model.provider,
      model: project.model.model,
    };
  }

  const alias = project.modelAlias;
  if (alias && !config.modelAliases?.[alias]) {
    throw new Error(`project_model_alias_not_found:${project.repo}:${alias}`);
  }
  if (alias && config.modelAliases?.[alias]) {
    return {
      provider: config.modelAliases[alias].provider,
      model: config.modelAliases[alias].model,
    };
  }

  const selectedModel = config.model || config.models?.[0];
  if (!selectedModel) throw new Error("model_not_configured");

  if (selectedModel.includes("/")) {
    const [provider, ...rest] = selectedModel.split("/");
    if (provider && rest.length > 0) {
      return { provider, model: rest.join("/") };
    }
  }

  return { provider: config.llm, model: selectedModel };
}

async function resolveApiKeyForProvider(
  config: ReviewFluxConfig,
  provider: string,
): Promise<string> {
  const profile = getActiveAuthProfile(config, provider);

  if (profile?.mode === "apikey") {
    const key = profile.apiKey.key.trim();
    if (!key) throw new Error(`api_key_missing_for_provider:${provider}`);
    return key;
  }

  if (profile?.mode === "oauth") {
    const oauth = profile.oauth;
    if (
      oauth.expiresAtEpochMs &&
      oauth.refreshToken &&
      Date.now() >= oauth.expiresAtEpochMs - 10_000
    ) {
      const refreshed = await refreshWithPiOAuth(provider, oauth);
      Object.assign(oauth, refreshed);
      saveConfig(config);
    }
    return apiKeyFromPiOAuth(provider, oauth);
  }

  if (provider === config.llm) {
    if (config.authMode === "apikey" && config.apiKey?.key?.trim()) {
      return config.apiKey.key.trim();
    }
    if (config.authMode === "oauth" && config.oauth?.accessToken) {
      if (
        config.oauth.expiresAtEpochMs &&
        config.oauth.refreshToken &&
        Date.now() >= config.oauth.expiresAtEpochMs - 10_000
      ) {
        const refreshed = await refreshWithPiOAuth(provider, config.oauth);
        Object.assign(config.oauth, refreshed);
        saveConfig(config);
      }
      return apiKeyFromPiOAuth(provider, config.oauth);
    }
  }

  throw new Error(`credentials_not_found_for_provider:${provider}`);
}

async function createReviewCommentFromLLM(params: {
  config: ReviewFluxConfig;
  project: ProjectConfig;
  repo: string;
  pr: PullRequestDetail;
  reason: ReviewTriggerReason;
  basePolicyGuidance: string;
  globalAgentsGuidance: string;
  projectContext: string;
}): Promise<{ raw: string; diff: string }> {
  const { provider, model } = resolveProjectModel(
    params.config,
    params.project,
  );
  const apiKey = await resolveApiKeyForProvider(params.config, provider);
  const diff = await ghExec([
    "pr",
    "diff",
    String(params.pr.number),
    "-R",
    params.repo,
  ]);

  const fallbackModel = getModel(provider as never, model as never);
  const baseUrl =
    provider === params.config.llm
      ? params.config.llmApiBaseUrl.replace(/\/$/, "")
      : (fallbackModel?.baseUrl ??
        params.config.llmApiBaseUrl.replace(/\/$/, ""));
  const reasoningEffort =
    provider === "openai" || provider === "openai-codex"
      ? resolveCodexEffort({
          authMode: provider === "openai-codex" ? "oauth" : "apikey",
          model,
          requested: params.config.effort,
        })
      : undefined;
  const client = createLlmProvider({
    authMode: "apikey",
    provider: provider as never,
    baseUrl,
    model,
    apiKey,
    reasoningEffort,
  });

  const raw = await client.generateReply([
    {
      role: "system",
      content: buildReviewSystemPrompt({
        repo: params.repo,
        prNumber: params.pr.number,
        reason: params.reason,
        basePolicyGuidance: params.basePolicyGuidance,
      }),
    },
    {
      role: "user",
      content: buildReviewUserPrompt({
        pr: params.pr,
        diff,
        globalAgentsGuidance: params.globalAgentsGuidance,
        projectContext: params.projectContext,
      }),
    },
  ]);

  return { raw, diff };
}

async function postManualReviewResponse(params: {
  repo: string;
  prNumber: number;
  body: string;
  trigger?: ManualReviewTrigger;
}): Promise<void> {
  if (canReplyInReviewThread(params.trigger)) {
    await postPullRequestReviewReply({
      repo: params.repo,
      prNumber: params.prNumber,
      replyToCommentId: params.trigger.reviewReplyToCommentId,
      body: params.body,
    });
    return;
  }

  await postPullRequestComment({
    repo: params.repo,
    prNumber: params.prNumber,
    body: buildIssueCommentFollowUpBody(params.body, params.trigger),
  });
}

function saveReviewStateIfOwned(params: {
  state: ReviewState;
  ownsState: boolean;
}): void {
  if (params.ownsState) {
    saveReviewState(params.state);
  }
}

export async function runReviewJob(params: {
  config: ReviewFluxConfig;
  project: ProjectConfig;
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  state?: ReviewState;
  manualTrigger?: ManualReviewTrigger;
}): Promise<void> {
  const basePolicyGuidance = loadBasePolicyGuidance();
  const globalAgentsGuidance = loadGlobalAgentsGuidance();
  const pr = await fetchPullRequestDetail(params.repo, params.prNumber);
  const state = params.state ?? loadReviewState();
  const ownsState = !params.state;
  const projectState = buildProjectReviewState(state, params.repo);

  const postedReviewKey = createPostedReviewKey({
    prNumber: params.prNumber,
    prHeadSha: pr.head.sha,
    reason: params.reason,
  });
  const manualTriggerKey = params.manualTrigger
    ? buildHandledManualTriggerKey(params.manualTrigger)
    : null;
  const inFlightKey = manualTriggerKey ?? postedReviewKey;

  if (
    isAutomaticReviewReason(params.reason) &&
    hasPostedReviewKey({
      postedReviewKeys: projectState.postedReviewKeys,
      prNumber: params.prNumber,
      prHeadSha: pr.head.sha,
      reason: params.reason,
    })
  ) {
    logReviewRuntimeEvent({
      level: "info",
      event: "review_skipped_already_posted",
      message:
        "Skipped automatic review because it was already posted for this PR head.",
      context: {
        repo: params.repo,
        prNumber: params.prNumber,
        reason: params.reason,
        eventKey: postedReviewKey,
      },
    });
    console.log(
      `[reviewflux] review skipped (already posted): ${params.repo}#${params.prNumber} reason=${params.reason}`,
    );
    return;
  }

  if (
    manualTriggerKey &&
    hasHandledManualTriggerKey(projectState, manualTriggerKey)
  ) {
    logReviewRuntimeEvent({
      level: "info",
      event: "review_skipped_manual_trigger_handled",
      message: "Skipped manual review because the trigger was already handled.",
      context: {
        repo: params.repo,
        prNumber: params.prNumber,
        reason: params.reason,
        eventKey: manualTriggerKey,
      },
    });
    console.log(
      `[reviewflux] review skipped (manual trigger already handled): ${params.repo}#${params.prNumber} trigger=${manualTriggerKey}`,
    );
    return;
  }

  if (inFlightReviewKeys.has(inFlightKey)) {
    logReviewRuntimeEvent({
      level: "info",
      event: "review_skipped_in_flight_duplicate",
      message:
        "Skipped duplicate review because an equivalent review is already in flight.",
      context: {
        repo: params.repo,
        prNumber: params.prNumber,
        reason: params.reason,
        eventKey: inFlightKey,
      },
    });
    console.log(
      `[reviewflux] review skipped (in-flight duplicate): ${params.repo}#${params.prNumber} key=${inFlightKey}`,
    );
    return;
  }
  inFlightReviewKeys.add(inFlightKey);

  try {
    let projectContext = "";
    try {
      projectContext = await buildRemoteProjectContextText(
        params.project,
        pr.base.sha,
      );
    } catch (error) {
      logReviewRuntimeEvent({
        level: "error",
        event: "review_context_load_failed",
        message:
          "Failed to load project context; continuing without remote context.",
        context: {
          repo: params.repo,
          prNumber: params.prNumber,
          reason: params.reason,
          eventKey: inFlightKey,
          errorMessage: REVIEW_CONTEXT_LOAD_FAILED_ERROR,
        },
      });
      console.error(
        `[reviewflux] failed to load context for ${params.repo}@${pr.base.sha}`,
      );
      console.error(error instanceof Error ? error.message : String(error));
    }

    const review = await createReviewCommentFromLLM({
      config: params.config,
      project: params.project,
      repo: params.repo,
      pr,
      reason: params.reason,
      basePolicyGuidance,
      globalAgentsGuidance,
      projectContext,
    });

    const resolvedReview = resolveReviewOutputFromModel(review.raw);
    const existingFingerprints =
      resolvedReview.findings.length > 0
        ? await loadExistingFindingFingerprints(params.repo, params.prNumber)
        : new Set<string>();
    const findingsToPost = filterAlreadyPostedFindings({
      findings: resolvedReview.findings,
      existingFingerprints,
    });

    if (
      resolvedReview.findings.length > 0 &&
      findingsToPost.length === 0 &&
      params.reason === "manual_force"
    ) {
      await postManualReviewResponse({
        repo: params.repo,
        prNumber: params.prNumber,
        body: buildNoNewFindingBody(),
        trigger: params.manualTrigger,
      });
      logReviewRuntimeEvent({
        level: "info",
        event: "review_manual_no_new_findings_response",
        message: "Posted manual no-new-findings response.",
        context: {
          repo: params.repo,
          prNumber: params.prNumber,
          reason: params.reason,
          eventKey: manualTriggerKey ?? postedReviewKey,
        },
      });
    } else if (
      resolvedReview.findings.length > 0 &&
      findingsToPost.length === 0
    ) {
      logReviewRuntimeEvent({
        level: "info",
        event: "review_skipped_no_new_findings",
        message:
          "Skipped posting because all findings already exist on the pull request.",
        context: {
          repo: params.repo,
          prNumber: params.prNumber,
          reason: params.reason,
          eventKey: postedReviewKey,
        },
      });
      console.log(
        `[reviewflux] review skipped (no new findings): ${params.repo}#${params.prNumber} reason=${params.reason}`,
      );
    } else {
      await postReviewOutput({
        repo: params.repo,
        prNumber: params.prNumber,
        prHeadSha: pr.head.sha,
        findings: findingsToPost,
        diff: review.diff,
        listPullRequestFiles,
        postSummaryComment: async ({ body }) => {
          if (params.reason === "manual_force") {
            await postManualReviewResponse({
              repo: params.repo,
              prNumber: params.prNumber,
              body,
              trigger: params.manualTrigger,
            });
            return;
          }
          await postPullRequestComment({
            repo: params.repo,
            prNumber: params.prNumber,
            body,
          });
        },
        postInlineReviewComment,
      });
      logReviewRuntimeEvent({
        level: "info",
        event: "review_posted",
        message: "Posted review findings.",
        context: {
          repo: params.repo,
          prNumber: params.prNumber,
          reason: params.reason,
          eventKey: postedReviewKey,
        },
      });
      console.log(
        `[reviewflux] review posted: ${params.repo}#${params.prNumber} reason=${params.reason}`,
      );
    }

    trackPostedReviewKey(projectState, postedReviewKey);
    if (manualTriggerKey) {
      trackHandledManualTriggerKey(projectState, manualTriggerKey);
    }
    saveReviewStateIfOwned({ state, ownsState });
  } finally {
    inFlightReviewKeys.delete(inFlightKey);
  }
}

export async function runQueuedReviewJob(params: {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  manualTrigger?: ManualReviewTrigger;
}): Promise<void> {
  const config = loadConfig();
  const project = config.projects?.[normalizeRepoKey(params.repo)] as
    | ProjectConfig
    | undefined;
  if (!project) {
    throw new Error(`project_not_configured:${params.repo}`);
  }

  await runReviewJob({
    config,
    project,
    repo: params.repo,
    prNumber: params.prNumber,
    reason: params.reason,
    manualTrigger: params.manualTrigger,
  });
}
