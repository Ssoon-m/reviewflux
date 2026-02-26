import { setTimeout as wait } from "node:timers/promises";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";

type OAuthTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresInSec?: number;
};

function resolveApiKeyForDaemon(cfg: ReviewFluxConfig): string {
  if (cfg.authMode === "oauth" && cfg.oauth?.accessToken) {
    return cfg.oauth.accessToken;
  }
  if (cfg.authMode === "apikey" && cfg.apiKey?.key?.trim()) {
    return cfg.apiKey.key.trim();
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

  if (
    cfg.authMode === "oauth" &&
    cfg.oauth?.accessToken &&
    cfg.oauth.expiresAtEpochMs &&
    cfg.oauth.refreshToken &&
    cfg.oauth.tokenUrl &&
    cfg.oauth.clientId &&
    Date.now() >= cfg.oauth.expiresAtEpochMs - 10_000
  ) {
    console.log("[reviewflux] access token expired soon. refreshing...");
    const token = await refreshOAuthToken({
      tokenUrl: cfg.oauth.tokenUrl,
      clientId: cfg.oauth.clientId,
      refreshToken: cfg.oauth.refreshToken,
    });
    cfg.oauth.accessToken = token.accessToken;
    cfg.oauth.refreshToken = token.refreshToken ?? cfg.oauth.refreshToken;
    cfg.oauth.tokenType = token.tokenType ?? cfg.oauth.tokenType;
    cfg.oauth.expiresAtEpochMs = token.expiresInSec ? Date.now() + token.expiresInSec * 1000 : undefined;
    saveConfig(cfg);
  }

  const apiKey = resolveApiKeyForDaemon(cfg);

  console.log("[reviewflux] waiting 3 seconds before test request...");
  await wait(3000);

  const selectedModel = cfg.model || cfg.models?.[0];
  if (!selectedModel) {
    console.error("[reviewflux] no model configured. run: reviewflux setup");
    process.exit(1);
  }

  try {
    const modelProvider = cfg.authMode === "oauth" ? "openai-codex" : "openai";
    const effort = cfg.effort ?? "medium";
    console.log(`[reviewflux] testing model: ${selectedModel} (provider=${modelProvider}, effort=${effort})`);
    const model = getModel(modelProvider, selectedModel as never);
    if (!model) {
      throw new Error(`model_not_supported:${modelProvider}/${selectedModel}`);
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
