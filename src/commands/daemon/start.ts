import { setTimeout as wait } from "node:timers/promises";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { apiKeyFromPiOAuth, refreshWithPiOAuth } from "../../auth/pi-oauth.js";
import { getActiveAuthProfile, loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";

function resolveDaemonAuth(cfg: ReviewFluxConfig):
  | { mode: "oauth"; oauth: NonNullable<ReviewFluxConfig["oauth"]> }
  | { mode: "apikey"; apiKey: NonNullable<ReviewFluxConfig["apiKey"]> } {
  const profile = getActiveAuthProfile(cfg, cfg.llm);
  if (profile?.mode === "oauth") return { mode: "oauth", oauth: profile.oauth };
  if (profile?.mode === "apikey") return { mode: "apikey", apiKey: profile.apiKey };

  // Legacy fallback
  if (cfg.authMode === "oauth" && cfg.oauth?.accessToken) return { mode: "oauth", oauth: cfg.oauth };
  if (cfg.authMode === "apikey" && cfg.apiKey?.key?.trim()) return { mode: "apikey", apiKey: cfg.apiKey };

  throw new Error("daemon_missing_credentials");
}

function extractAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: Array<{ type?: string; text?: string }> };
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;

    const text = message.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("\n")
      .trim();

    if (text.length > 0) return text;
  }
  return "";
}

function resolvePiProvider(params: {
  llm: ReviewFluxConfig["llm"];
  authMode: "oauth" | "apikey";
  selectedModel: string;
}): "openai" | "openai-codex" | "google" | "google-gemini-cli" {
  const { llm, authMode, selectedModel } = params;
  if (selectedModel.includes("/")) {
    const [rawProvider, ...rest] = selectedModel.split("/");
    if (rest.length > 0) {
      const normalized = rawProvider.trim().toLowerCase();
      if (normalized === "google" || normalized === "gemini") {
        return authMode === "oauth" ? "google-gemini-cli" : "google";
      }
      if (normalized === "openai-codex") return "openai-codex";
      if (normalized === "openai") return authMode === "oauth" ? "openai-codex" : "openai";
    }
  }

  if (llm === "gemini") return authMode === "oauth" ? "google-gemini-cli" : "google";
  return authMode === "oauth" ? "openai-codex" : "openai";
}

export async function runDaemonStartCommand(): Promise<void> {
  const cfg = loadConfig();
  console.log("[reviewflux] daemon start");

  const activeAuth = resolveDaemonAuth(cfg);

  if (
    activeAuth.mode === "oauth" &&
    activeAuth.oauth.expiresAtEpochMs &&
    activeAuth.oauth.refreshToken &&
    Date.now() >= activeAuth.oauth.expiresAtEpochMs - 10_000
  ) {
    console.log("[reviewflux] access token expired soon. refreshing...");
    const refreshed = await refreshWithPiOAuth(cfg.llm, activeAuth.oauth);
    Object.assign(activeAuth.oauth, refreshed);
    if (cfg.oauth) Object.assign(cfg.oauth, activeAuth.oauth);
    saveConfig(cfg);
  }

  const apiKey =
    activeAuth.mode === "oauth" ? apiKeyFromPiOAuth(cfg.llm, activeAuth.oauth) : activeAuth.apiKey.key.trim();

  console.log("[reviewflux] waiting 3 seconds before test request...");
  await wait(3000);

  const selectedModel = cfg.model || cfg.models?.[0];
  if (!selectedModel) {
    console.error("[reviewflux] no model configured. run: reviewflux setup");
    process.exit(1);
  }

  try {
    const modelProvider = resolvePiProvider({ llm: cfg.llm, authMode: activeAuth.mode, selectedModel });
    const modelId = selectedModel.includes("/") ? selectedModel.split("/").slice(1).join("/") : selectedModel;
    const effort = cfg.effort ?? "medium";

    console.log(`[reviewflux] testing model: ${modelId} (provider=${modelProvider}, effort=${effort})`);
    const model = getModel(modelProvider as never, modelId as never);
    if (!model) throw new Error(`model_not_supported:${modelProvider}/${modelId}`);

    const modelWithBaseUrl =
      modelProvider === "openai-codex"
        ? model
        : {
            ...model,
            baseUrl: cfg.llmApiBaseUrl.replace(/\/$/, ""),
          };

    const agent = new Agent({ getApiKey: async () => apiKey });
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
