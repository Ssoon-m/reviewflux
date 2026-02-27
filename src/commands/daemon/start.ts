import { setTimeout as wait } from "node:timers/promises";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { getActiveAuthProfile, loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";

type OAuthTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresInSec?: number;
};

function resolveDaemonAuth(cfg: ReviewFluxConfig):
  | { mode: "oauth"; oauth: NonNullable<ReviewFluxConfig["oauth"]> }
  | { mode: "apikey"; apiKey: NonNullable<ReviewFluxConfig["apiKey"]> } {
  const provider = cfg.llm;
  const profile = getActiveAuthProfile(cfg, provider);

  if (profile?.mode === "oauth") {
    return { mode: "oauth", oauth: profile.oauth };
  }
  if (profile?.mode === "apikey") {
    return { mode: "apikey", apiKey: profile.apiKey };
  }

  // Legacy fallback (single-auth config)
  if (cfg.authMode === "oauth" && cfg.oauth?.accessToken) {
    return { mode: "oauth", oauth: cfg.oauth };
  }
  if (cfg.authMode === "apikey" && cfg.apiKey?.key?.trim()) {
    return { mode: "apikey", apiKey: cfg.apiKey };
  }

  throw new Error("daemon_missing_credentials");
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<{ status: number; ok: boolean; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshOAuthToken(params: {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });

  const rawRes = await fetchTextWithTimeout(
    params.tokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    30_000,
  );

  if (!rawRes.ok) throw new Error(`oauth_refresh_failed (${rawRes.status}): ${rawRes.text}`);

  const json = JSON.parse(rawRes.text) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  if (!json.access_token) throw new Error("oauth_refresh_missing_access_token");

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenType: json.token_type,
    expiresInSec: json.expires_in,
  };
}

function extractAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: Array<{ type?: string; text?: string }> };
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    const text = message.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("\n")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

export async function runDaemonStartCommand(): Promise<void> {
  const cfg = loadConfig();
  console.log("[reviewflux] daemon start");

  const activeAuth = resolveDaemonAuth(cfg);

  if (
    activeAuth.mode === "oauth" &&
    activeAuth.oauth.accessToken &&
    activeAuth.oauth.expiresAtEpochMs &&
    activeAuth.oauth.refreshToken &&
    activeAuth.oauth.tokenUrl &&
    activeAuth.oauth.clientId &&
    Date.now() >= activeAuth.oauth.expiresAtEpochMs - 10_000
  ) {
    console.log("[reviewflux] access token expired soon. refreshing...");
    const token = await refreshOAuthToken({
      tokenUrl: activeAuth.oauth.tokenUrl,
      clientId: activeAuth.oauth.clientId,
      refreshToken: activeAuth.oauth.refreshToken,
    });

    activeAuth.oauth.accessToken = token.accessToken;
    activeAuth.oauth.refreshToken = token.refreshToken ?? activeAuth.oauth.refreshToken;
    activeAuth.oauth.tokenType = token.tokenType ?? activeAuth.oauth.tokenType;
    activeAuth.oauth.expiresAtEpochMs = token.expiresInSec ? Date.now() + token.expiresInSec * 1000 : undefined;

    // Keep legacy top-level fields in sync when they exist
    if (cfg.oauth) {
      cfg.oauth.accessToken = activeAuth.oauth.accessToken;
      cfg.oauth.refreshToken = activeAuth.oauth.refreshToken;
      cfg.oauth.tokenType = activeAuth.oauth.tokenType;
      cfg.oauth.expiresAtEpochMs = activeAuth.oauth.expiresAtEpochMs;
    }

    saveConfig(cfg);
  }

  const apiKey = activeAuth.mode === "oauth" ? activeAuth.oauth.accessToken : activeAuth.apiKey.key.trim();

  console.log("[reviewflux] waiting 3 seconds before test request...");
  await wait(3000);

  const selectedModel = cfg.model || cfg.models?.[0];
  if (!selectedModel) {
    console.error("[reviewflux] no model configured. run: reviewflux setup");
    process.exit(1);
  }

  try {
    const resolveProvider = (): string => {
      if (selectedModel.includes("/")) {
        const [rawProvider, ...rest] = selectedModel.split("/");
        if (rest.length > 0) {
          const normalized = rawProvider.trim().toLowerCase();
          if (normalized === "google" || normalized === "gemini") return "google";
          if (normalized === "openai-codex") return "openai-codex";
          if (normalized === "openai") return "openai";
        }
      }

      if (cfg.llm === "gemini") return "google";
      if (cfg.llm === "codex" || activeAuth.mode === "oauth") return "openai-codex";
      return "openai";
    };

    const resolveModelId = (): string => {
      if (!selectedModel.includes("/")) return selectedModel;
      const [, ...rest] = selectedModel.split("/");
      return rest.join("/") || selectedModel;
    };

    const modelProvider = resolveProvider();
    const modelId = resolveModelId();
    const effort = cfg.effort ?? "medium";
    console.log(`[reviewflux] testing model: ${modelId} (provider=${modelProvider}, effort=${effort})`);
    const model = getModel(modelProvider as never, modelId as never);
    if (!model) {
      throw new Error(`model_not_supported:${modelProvider}/${modelId}`);
    }
    const modelWithBaseUrl =
      modelProvider === "openai-codex"
        ? model
        : {
            ...model,
            baseUrl: cfg.llmApiBaseUrl.replace(/\/$/, ""),
          };

    const agent = new Agent({
      getApiKey: async () => apiKey,
    });
    agent.setSystemPrompt("You are a helpful assistant.");
    agent.setModel(modelWithBaseUrl);
    agent.setThinkingLevel(effort);

    await agent.prompt("안녕?");

    const text = extractAssistantText(agent.state.messages as unknown[]);

    console.log("[reviewflux] response:");
    if (text.length > 0) {
      console.log(text);
    } else {
      console.log("(no text block returned)");
      console.log("[reviewflux] message roles:");
      console.log(agent.state.messages.map((message) => (message as { role?: string }).role).join(","));
      console.log("[reviewflux] raw messages:");
      console.log(JSON.stringify(agent.state.messages, null, 2));
    }
  } catch (error) {
    console.error("[reviewflux] request failed (pi-ai)");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
