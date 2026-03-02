import { spawn, spawnSync } from "node:child_process";
import { getModel, getModels, getOAuthProviders, getProviders } from "@mariozechner/pi-ai";
import { promptPassword, promptSelect, promptText } from "../../cli/clack-prompter.js";
import {
  ensureReviewFluxHome,
  saveConfig,
  type AuthMode,
  type LlmProvider,
  type ReviewFluxConfig,
} from "../../cli/config.js";
import { loginWithPiOAuth, resolveOAuthProviderId } from "../../auth/pi-oauth.js";
import {
  getCustomProviderId,
  type CustomCompatibility,
  validateCustomProviderConfig,
} from "../../llm/custom-provider.js";
import { getCodexEffortLevels } from "../../llm/reasoning-effort.js";

type SetupOptions = { advanced: boolean };

function parseSetupOptions(args: string[]): SetupOptions {
  return { advanced: args.includes("--advanced") };
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

/** Provider label: OAuth providers use pi-ai’s .name; others use a short display hint. */
function getProviderChoiceLabel(providerId: string): string {
  const oauth = getOAuthProviders().find((p) => p.id === providerId);
  if (oauth) return oauth.name;
  if (providerId === "google") return "Google Gemini API key";
  if (providerId === "openai") return "OpenAI API key";
  return providerId;
}

/** OpenClaw-style labels and hints (aligned with openclaw auth-choice-options AUTH_CHOICE_GROUP_DEFS). */
const GROUP_LABELS: Record<string, string> = {
  google: "Google",
  openai: "OpenAI",
  anthropic: "Anthropic",
  amazon: "Amazon (Bedrock)",
  azure: "Azure",
  mistral: "Mistral AI",
  huggingface: "Hugging Face",
  xai: "xAI (Grok)",
  groq: "Groq",
  openrouter: "OpenRouter",
  github: "Copilot",
  minimax: "MiniMax",
  cerebras: "Cerebras",
  vercel: "Vercel AI Gateway",
  zai: "Z.AI",
  opencode: "OpenCode Zen",
  kimi: "Kimi",
};

const GROUP_HINTS: Partial<Record<string, string>> = {
  google: "Gemini API key + OAuth",
  openai: "Codex OAuth + API key",
  anthropic: "setup-token + API key",
  xai: "API key",
  groq: "API key",
  openrouter: "API key",
  mistral: "API key",
  huggingface: "Inference API (HF token)",
  github: "GitHub + local proxy",
  minimax: "M2.5 (recommended)",
  opencode: "API key",
  vercel: "API key",
  zai: "GLM Coding Plan / Global / CN",
};

type ProviderGroup = { groupKey: string; groupLabel: string; providers: string[]; hint?: string };

/** Build OpenClaw-style groups: same vendor → one first-level choice with auth hint, then "X auth method". */
function getProviderGroups(): ProviderGroup[] {
  const oauthIds = new Set(getOAuthProviders().map((p) => p.id));
  const all = getProviders().slice().sort((a, b) => a.localeCompare(b));
  const byGroup = new Map<string, string[]>();

  for (const id of all) {
    const key = id.includes("-") ? id.split("-")[0]! : id;
    const list = byGroup.get(key) ?? [];
    list.push(id);
    byGroup.set(key, list);
  }

  return Array.from(byGroup.entries())
    .map(([key, providers]) => {
      const sorted = providers.sort((a, b) => a.localeCompare(b));
      const hasOAuth = sorted.some((p) => oauthIds.has(p));
      const hasApikey = sorted.some((p) => !oauthIds.has(p));
      const derivedHint =
        GROUP_HINTS[key] ??
        (hasOAuth && hasApikey ? "API key + OAuth" : hasOAuth ? "OAuth" : "API key");
      return {
        groupKey: key,
        groupLabel: GROUP_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
        providers: sorted,
        hint: derivedHint,
      };
    })
    .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
}

/** OAuth support comes from pi-ai’s OAuth provider registry only. */
function isOAuthCapableProvider(provider: string): boolean {
  return getOAuthProviders().some((p) => p.id === provider);
}

/** Use the chosen provider id as-is; pi-ai defines models and auth per provider. */
function resolveApiProviderForSetup(params: { authMode: AuthMode; provider: LlmProvider }): string {
  return params.provider;
}

function assertModelSupportedByPiAi(params: {
  authMode: AuthMode;
  provider: LlmProvider;
  model: string;
}): void {
  const piProvider = resolveApiProviderForSetup(params);
  const resolved = getModel(piProvider as never, params.model as never);
  if (!resolved) throw new Error(`model_not_supported_by_pi_ai:${piProvider}/${params.model}`);
}

function getSelectableModels(params: {
  authMode: AuthMode;
  provider: LlmProvider;
}): Array<{ id: string; name: string }> {
  const provider = resolveApiProviderForSetup(params);

  return getModels(provider as never)
    .map((model) => ({ id: model.id, name: model.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function pickDefaultModel(params: {
  message: string;
  authMode: AuthMode;
  provider: LlmProvider;
  defaultModel?: string;
}): Promise<string> {
  const available = getSelectableModels(params);
  const fallback = params.defaultModel ?? available[0]?.id;

  if (!fallback) {
    throw new Error(`no_models_for_provider:${params.provider}`);
  }

  return promptSelect<string>({
    message: params.message,
    options: available.map((model) => ({ label: `${model.id} (${model.name})`, value: model.id })),
    initialValue: fallback,
  });
}

function openBrowser(url: string): boolean {
  const platform = process.platform;

  const spawnDetached = (command: string, args: string[]) => {
    const proc = spawn(command, args, { stdio: "ignore", detached: true });
    proc.unref();
    return proc.pid != null;
  };

  if (platform === "darwin") {
    const probe = spawnSync("which", ["open"], { encoding: "utf8" });
    if (probe.status !== 0) return false;
    return spawnDetached("open", [url]);
  }

  if (platform === "win32") {
    return spawnDetached("cmd", ["/c", "start", "", url]);
  }

  const probe = spawnSync("which", ["xdg-open"], { encoding: "utf8" });
  if (probe.status !== 0) return false;
  return spawnDetached("xdg-open", [url]);
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

async function pickCodexEffort(params: {
  authMode: AuthMode;
  model: string;
  defaultEffort?: "low" | "medium" | "high" | "xhigh";
}): Promise<"low" | "medium" | "high" | "xhigh"> {
  const supported = getCodexEffortLevels({ authMode: params.authMode, model: params.model });
  const fallback = supported.includes("medium") ? "medium" : supported[0] ?? "low";

  return promptSelect<"low" | "medium" | "high" | "xhigh">({
    message: `Select reasoning effort (${supported.join("/")})`,
    options: supported.map((level) => ({ label: level, value: level })),
    initialValue: params.defaultEffort && supported.includes(params.defaultEffort) ? params.defaultEffort : fallback,
  });
}

function defaultBaseUrlForProvider(provider: string): string {
  const firstModel = getModels(provider as never)[0];
  return firstModel?.baseUrl ?? "https://api.openai.com/v1";
}

/** Orchestrates prompts for custom provider; validation is delegated to llm/custom-provider. */
async function saveCustomProviderConfig(): Promise<void> {
  const baseUrl = assertNonEmpty(
    await promptText({ message: "Custom endpoint base URL", initialValue: "https://api.openai.com/v1" }),
    "base_url",
  );
  const modelId = assertNonEmpty(
    await promptText({ message: "Model ID", placeholder: "e.g. gpt-4o or claude-3-5-sonnet" }),
    "model_id",
  );
  const compatibility = (await promptSelect<CustomCompatibility>({
    message: "API compatibility",
    options: [
      { label: "OpenAI", value: "openai", hint: "OpenAI-style /v1/chat/completions" },
      { label: "Anthropic", value: "anthropic", hint: "Anthropic Messages API" },
    ],
    initialValue: "openai",
  })) as CustomCompatibility;
  const key = assertNonEmpty(await promptPassword({ message: "API key", mask: "*" }), "api_key");

  const validated = validateCustomProviderConfig({ baseUrl, modelId, compatibility, apiKey: key });
  const provider = getCustomProviderId(validated.compatibility);
  const profileId = `${provider}:default`;

  const config: ReviewFluxConfig = {
    appName: "reviewflux",
    llm: provider,
    authMode: "apikey",
    llmApiBaseUrl: validated.baseUrl,
    model: validated.modelId,
    apiKey: { key: validated.apiKey ?? "" },
    auth: {
      profiles: {
        [profileId]: {
          provider,
          mode: "apikey",
          apiKey: { key: validated.apiKey ?? "" },
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

async function runSetup(options: SetupOptions): Promise<void> {
  const home = ensureReviewFluxHome();

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);

  const groups = getProviderGroups();
  if (groups.length === 0) {
    throw new Error("no_providers_from_pi_ai");
  }

  const SKIP_VALUE = "__skip__";
  const BACK_VALUE = "__back__";
  const CUSTOM_GROUP_VALUE = "__custom__";

  let provider: LlmProvider;
  while (true) {
    const selectedGroupKey = await promptSelect<string>({
      message: "Model/auth provider",
      options: [
        { label: "Custom Provider", value: CUSTOM_GROUP_VALUE, hint: "Any OpenAI or Anthropic compatible endpoint" },
        ...groups.map((g) => ({
          label: g.groupLabel,
          value: g.groupKey,
          hint: g.hint,
        })),
        { label: "Skip for now", value: SKIP_VALUE },
      ],
      initialValue:
        groups.find((g) => g.providers.includes("openai-codex"))?.groupKey ?? groups[0]!.groupKey,
    });

    if (selectedGroupKey === SKIP_VALUE) {
      console.log("[reviewflux] setup skipped. Run reviewflux setup again when ready.");
      return;
    }

    if (selectedGroupKey === CUSTOM_GROUP_VALUE) {
      await saveCustomProviderConfig();
      return;
    }

    const selectedGroup = groups.find((g) => g.groupKey === selectedGroupKey)!;

    if (selectedGroup.providers.length === 1) {
      provider = selectedGroup.providers[0]!;
      break;
    }

    const methodSelection = await promptSelect<string>({
      message: `${selectedGroup.groupLabel} auth method`,
      options: [
        ...selectedGroup.providers.map((p) => ({
          label: getProviderChoiceLabel(p),
          value: p,
        })),
        { label: "Back", value: BACK_VALUE },
      ],
      initialValue:
        selectedGroup.providers.find((p) => p === "openai-codex" || p === "google-gemini-cli") ??
        selectedGroup.providers[0]!,
    });

    if (methodSelection === BACK_VALUE) {
      continue;
    }
    provider = methodSelection as LlmProvider;
    break;
  }

  const authMode: AuthMode = isOAuthCapableProvider(provider) ? "oauth" : "apikey";

  const defaultBaseUrl = defaultBaseUrlForProvider(resolveApiProviderForSetup({ authMode, provider }));
  let llmApiBaseUrl = defaultBaseUrl;

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await promptText({ message: "LLM API base URL", initialValue: defaultBaseUrl })) || defaultBaseUrl,
      "llm_api_base_url",
    );
  }

  const profileId = `${provider}:default`;

  if (authMode === "apikey") {
    const key = assertNonEmpty(await promptPassword({ message: "Paste API key", mask: "*" }), "api_key");
    const model = await pickDefaultModel({
      message: "Select default model",
      authMode,
      provider,
    });
    assertModelSupportedByPiAi({ authMode, provider, model });

    const effort = provider === "openai-codex" ? await pickCodexEffort({ authMode, model, defaultEffort: "medium" }) : undefined;

    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: provider,
      authMode,
      llmApiBaseUrl,
      model,
      ...(effort ? { effort } : {}),
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

  if (!isOAuthCapableProvider(provider)) {
    throw new Error(`oauth_not_supported_for_provider:${provider}`);
  }

  const oauth = await collectOAuthConfig(provider);
  const model = await pickDefaultModel({
    message: "Select default model (OAuth verified)",
    authMode,
    provider,
  });
  assertModelSupportedByPiAi({ authMode, provider, model });

  const effort = provider === "openai-codex" ? await pickCodexEffort({ authMode, model, defaultEffort: "medium" }) : undefined;

  const config: ReviewFluxConfig = {
    appName: "reviewflux",
    llm: provider,
    authMode,
    llmApiBaseUrl,
    model,
    ...(effort ? { effort } : {}),
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
