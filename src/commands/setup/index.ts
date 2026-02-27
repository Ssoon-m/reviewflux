import { spawn, spawnSync } from "node:child_process";
import { getModel, getModels } from "@mariozechner/pi-ai";
import { promptPassword, promptSelect, promptText } from "../../cli/clack-prompter.js";
import {
  ensureReviewFluxHome,
  saveConfig,
  type AuthMode,
  type EffortLevel,
  type LlmProvider,
  type ReviewFluxConfig,
} from "../../cli/config.js";
import { loginWithPiOAuth, resolveOAuthProviderId } from "../../auth/pi-oauth.js";

type SetupOptions = { advanced: boolean };

const DEFAULT_MODEL = "gpt-5.3-codex";

function parseSetupOptions(args: string[]): SetupOptions {
  return { advanced: args.includes("--advanced") };
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

function resolvePiProviderForSetup(params: {
  authMode: AuthMode;
  provider: LlmProvider;
}): "openai" | "openai-codex" | "google" | "google-gemini-cli" {
  if (params.provider === "gemini") {
    return params.authMode === "oauth" ? "google-gemini-cli" : "google";
  }
  return params.authMode === "oauth" ? "openai-codex" : "openai";
}

function assertModelSupportedByPiAi(params: {
  authMode: AuthMode;
  provider: LlmProvider;
  model: string;
}): void {
  const piProvider = resolvePiProviderForSetup(params);
  const resolved = getModel(piProvider, params.model as never);
  if (!resolved) throw new Error(`model_not_supported_by_pi_ai:${piProvider}/${params.model}`);
}

function getSelectableModels(params: {
  authMode: AuthMode;
  provider: LlmProvider;
}): Array<{ id: string; name: string }> {
  const provider = resolvePiProviderForSetup(params);

  if (provider === "google" || provider === "google-gemini-cli") {
    return getModels(provider)
      .filter((model) => model.id.startsWith("gemini-"))
      .map((model) => ({ id: model.id, name: model.name }));
  }

  if (provider === "openai-codex") {
    return getModels("openai-codex").map((model) => ({ id: model.id, name: model.name }));
  }

  return getModels("openai")
    .filter((model) => model.id.includes("codex"))
    .map((model) => ({ id: model.id, name: model.name }));
}

async function pickDefaultModel(params: {
  message: string;
  authMode: AuthMode;
  provider: LlmProvider;
  defaultModel?: string;
}): Promise<string> {
  const available = getSelectableModels(params);
  const fallback = available.find((m) => m.id === DEFAULT_MODEL)?.id ?? available[0]?.id ?? "gpt-5-codex";

  return promptSelect<string>({
    message: params.message,
    options: available.map((model) => ({ label: `${model.id} (${model.name})`, value: model.id })),
    initialValue: params.defaultModel ?? fallback,
  });
}

async function pickEffort(defaultEffort: EffortLevel = "medium"): Promise<EffortLevel> {
  return promptSelect<EffortLevel>({
    message: "Select effort",
    options: [
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Extra high", value: "xhigh" },
    ],
    initialValue: defaultEffort,
  });
}

function openBrowser(url: string): boolean {
  const platform = process.platform;

  if (platform === "darwin") {
    const probe = spawnSync("which", ["open"], { encoding: "utf8" });
    if (probe.status !== 0) return false;
    const proc = spawn("open", [url], { stdio: "ignore" });
    return proc.pid != null;
  }

  if (platform === "win32") {
    const proc = spawn("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    return proc.pid != null;
  }

  const probe = spawnSync("which", ["xdg-open"], { encoding: "utf8" });
  if (probe.status !== 0) return false;
  const proc = spawn("xdg-open", [url], { stdio: "ignore" });
  return proc.pid != null;
}

async function collectOAuthConfig(provider: LlmProvider): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
  const oauthMode = await promptSelect<"browser" | "paste">({
    message: "OAuth setup method",
    options: [
      { label: "Browser login (recommended)", value: "browser" },
      { label: "Paste existing token", value: "paste" },
    ],
    initialValue: "browser",
  });

  if (oauthMode === "paste") {
    const accessToken = assertNonEmpty(
      await promptPassword({ message: "Paste OAuth access token", mask: "*" }),
      "oauth_access_token",
    );
    const refreshTokenRaw = await promptPassword({ message: "Refresh token (optional)", mask: "*" });
    const refreshToken = refreshTokenRaw.trim() || undefined;

    const providerId = resolveOAuthProviderId(provider);
    const projectIdRaw =
      providerId === "google-gemini-cli"
        ? await promptText({ message: "Google project ID (optional; needed for refresh)", initialValue: "" })
        : "";

    return {
      oauthProviderId: providerId,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(projectIdRaw.trim() ? { projectId: projectIdRaw.trim() } : {}),
    };
  }

  return loginWithPiOAuth(provider, {
    onAuth: ({ url }) => {
      console.log("\n[reviewflux] OAuth URL ready");
      console.log("Open this URL in your LOCAL browser:");
      console.log(`${url}\n`);

      const opened = openBrowser(url);
      if (opened) {
        console.log("[reviewflux] opening browser for OAuth login...");
      } else {
        console.log("[reviewflux] browser auto-open failed. open the URL above manually.");
      }
    },
    onPrompt: async (prompt) => {
      while (true) {
        const value = await promptText({ message: prompt.message, initialValue: prompt.placeholder ?? "" });
        if (value.trim().length > 0 || prompt.allowEmpty) return value;
        console.log("[reviewflux] OAuth input is required.");
      }
    },
    onProgress: (message) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    },
  });
}

async function runSetup(options: SetupOptions): Promise<void> {
  const home = ensureReviewFluxHome();

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);

  const provider = await promptSelect<LlmProvider>({
    message: "Select LLM provider",
    options: [
      { label: "codex (OpenAI)", value: "codex" },
      { label: "gemini (Google)", value: "gemini" },
    ],
    initialValue: "codex",
  });

  const authMode = await promptSelect<AuthMode>({
    message: "Select auth mode",
    options: [
      { label: "OAuth", value: "oauth" },
      { label: "API Key", value: "apikey" },
    ],
    initialValue: provider === "gemini" ? "apikey" : "oauth",
  });

  const defaultBaseUrl =
    provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1";
  let llmApiBaseUrl = defaultBaseUrl;

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await promptText({ message: "LLM API base URL", initialValue: defaultBaseUrl })) || defaultBaseUrl,
      "llm_api_base_url",
    );
  }

  const effort = await pickEffort("medium");
  const profileId = `${provider}:default`;

  if (authMode === "apikey") {
    const key = assertNonEmpty(await promptPassword({ message: "Paste API key", mask: "*" }), "api_key");
    const model = await pickDefaultModel({
      message: "Select default model",
      authMode,
      provider,
      defaultModel: provider === "gemini" ? "gemini-2.5-flash" : "gpt-5-codex",
    });
    assertModelSupportedByPiAi({ authMode, provider, model });

    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: provider,
      authMode,
      llmApiBaseUrl,
      model,
      effort,
      apiKey: { key },
      auth: {
        profiles: {
          [profileId]: {
            provider,
            mode: "apikey",
            apiKey: { key },
          },
        },
        order: {
          [provider]: [profileId],
        },
      },
    };

    const path = saveConfig(config);
    console.log(`\n[reviewflux] setup complete: ${path}`);
    console.log("Next: reviewflux daemon start");
    return;
  }

  const oauth = await collectOAuthConfig(provider);
  const model = await pickDefaultModel({
    message: "Select default model (OAuth verified)",
    authMode,
    provider,
    defaultModel: provider === "gemini" ? "gemini-2.5-flash" : "gpt-5.3-codex",
  });
  assertModelSupportedByPiAi({ authMode, provider, model });

  const config: ReviewFluxConfig = {
    appName: "reviewflux",
    llm: provider,
    authMode,
    llmApiBaseUrl,
    model,
    effort,
    oauth,
    auth: {
      profiles: {
        [profileId]: {
          provider,
          mode: "oauth",
          oauth,
        },
      },
      order: {
        [provider]: [profileId],
      },
    },
  };

  const path = saveConfig(config);
  console.log(`\n[reviewflux] setup complete: ${path}`);
  console.log("Next: reviewflux daemon start");
}

export async function runSetupCommand(args: string[]): Promise<void> {
  await runSetup(parseSetupOptions(args));
}
