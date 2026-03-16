import { spawn, spawnSync } from "node:child_process";
import { promptSelect } from "../../cli/clack-prompter.js";
import { promptPassword, promptText } from "../../cli/clack-prompter.js";
import { getOAuthProvider, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { loginWithPiOAuth, resolveOAuthProviderId } from "../../auth/pi-oauth.js";
import { getActiveAuthProfile, type LlmProvider, type OAuthConfig, type ReviewFluxConfig } from "../../cli/config.js";
import {
  getProviderChoiceHint,
  getProviderChoiceLabel,
  getProviderGroupsForSelection,
  groupKeyOfProvider,
} from "../../llm/provider-catalog.js";

export async function pickRepoProvider(initialProvider: string): Promise<string> {
  const groups = getProviderGroupsForSelection();
  const initialGroupKey = groupKeyOfProvider(initialProvider);
  const defaultGroupKey = groups.some((group) => group.groupKey === initialGroupKey)
    ? initialGroupKey
    : groups[0]?.groupKey;

  const selectedGroupKey = await promptSelect<string>({
    message: "Select provider",
    options: groups.map((group) => ({
      label: group.groupLabel,
      value: group.groupKey,
      hint: group.hint,
    })),
    initialValue: defaultGroupKey,
  });

  const selectedGroup = groups.find((group) => group.groupKey === selectedGroupKey);
  if (!selectedGroup) {
    throw new Error(`provider_group_not_found:${selectedGroupKey}`);
  }

  if (selectedGroup.providers.length === 1) {
    return selectedGroup.providers[0]!;
  }

  return promptSelect<string>({
    message: `${selectedGroup.groupLabel} provider`,
    options: selectedGroup.providers.map((provider) => ({
      label: getProviderChoiceLabel(provider),
      value: provider,
      hint: getProviderChoiceHint(provider),
    })),
    initialValue: selectedGroup.providers.includes(initialProvider) ? initialProvider : selectedGroup.providers[0],
  });
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
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

function extractDeviceCode(instructions: string | undefined): string | undefined {
  if (!instructions) return undefined;
  const match = instructions.match(/enter\s+code\s*:\s*(.+)$/i);
  const code = match?.[1]?.trim();
  return code && code.length > 0 ? code : undefined;
}

function manualOAuthPromptForProvider(provider: LlmProvider): { message: string; placeholder: string } {
  if (provider === "openai-codex") {
    return {
      message: "Paste OpenAI redirect URL or authorization code",
      placeholder: "http://localhost:1455/auth/callback?code=...&state=...",
    };
  }
  return {
    message: "Paste authorization code",
    placeholder: "XXXX-XXXX",
  };
}

function isOAuthCapableProvider(provider: string): boolean {
  return getOAuthProviders().some((entry) => entry.id === provider);
}

async function collectOAuthConfig(provider: LlmProvider): Promise<OAuthConfig> {
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

  const isGitHubCopilot = provider === "github-copilot";
  const usesCallbackServer = getOAuthProvider(provider)?.usesCallbackServer === true;

  const callbacks: Parameters<typeof loginWithPiOAuth>[1] = {
    onAuth: ({ url, instructions }) => {
      console.log("\n[reviewflux] OAuth authorization required");
      if (isGitHubCopilot) {
        console.log("GitHub Copilot device login");
        console.log(`Verification URL: ${url}`);
        const code = extractDeviceCode(instructions);
        if (code) console.log(`Enter code: ${code}`);
      } else {
        console.log("Open this URL in your LOCAL browser:");
        console.log(`${url}`);
      }
      if (instructions?.trim()) console.log(`\n${instructions.trim()}`);
      if (usesCallbackServer && !isGitHubCopilot) {
        console.log("[reviewflux] waiting for browser callback. If needed, paste redirect URL in terminal.");
      }
      console.log("");

      const opened = openBrowser(url);
      if (opened) {
        console.log("[reviewflux] opening browser for OAuth login...");
      } else {
        console.log("[reviewflux] browser auto-open failed. open the URL above manually.");
      }
    },
    onPrompt: async (prompt) => {
      if (isGitHubCopilot && prompt.message.includes("GitHub Enterprise URL/domain")) {
        console.log("[reviewflux] Using github.com (press setup again for enterprise if needed).");
        return "";
      }

      const anthropicCodePlaceholder =
        provider === "anthropic" && /authorization code/i.test(prompt.message) ? "code#state" : prompt.placeholder;

      while (true) {
        const value = await promptText({ message: prompt.message, initialValue: anthropicCodePlaceholder ?? "" });
        if (value.trim().length > 0 || prompt.allowEmpty) return value;
        console.log("[reviewflux] OAuth input is required.");
      }
    },
    onProgress: (message) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    },
  };

  if (provider === "openai-codex") {
    callbacks.onManualCodeInput = async () => {
      const manualPrompt = manualOAuthPromptForProvider(provider);
      return assertNonEmpty(
        await promptText({
          message: manualPrompt.message,
          placeholder: manualPrompt.placeholder,
        }),
        "oauth_manual_code",
      );
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await loginWithPiOAuth(provider, callbacks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isStateMismatch = /state/i.test(message);
      if (!isStateMismatch || attempt === 1) throw error;
      console.log("[reviewflux] OAuth state mismatch detected. Retrying with a fresh login session...");
      console.log("[reviewflux] Use only the latest URL opened by this retry.");
    }
  }

  throw new Error("oauth_login_failed");
}

export async function ensureProviderCredentials(config: ReviewFluxConfig, provider: string): Promise<void> {
  const active = getActiveAuthProfile(config, provider);
  if (active?.mode === "oauth" && active.oauth.accessToken?.trim()) return;
  if (active?.mode === "apikey" && active.apiKey.key?.trim()) return;

  const profiles = { ...(config.auth?.profiles ?? {}) };
  const order = { ...(config.auth?.order ?? {}) };
  const profileId = `${provider}:default`;

  if (isOAuthCapableProvider(provider)) {
    const oauth = await collectOAuthConfig(provider as LlmProvider);
    profiles[profileId] = { provider, mode: "oauth", oauth };
    order[provider] = [profileId, ...(order[provider] ?? []).filter((id) => id !== profileId)];
    config.auth = { profiles, order };
    return;
  }

  const key = assertNonEmpty(await promptPassword({ message: `Paste ${provider} API key`, mask: "*" }), "api_key");
  profiles[profileId] = { provider, mode: "apikey", apiKey: { key } };
  order[provider] = [profileId, ...(order[provider] ?? []).filter((id) => id !== profileId)];
  config.auth = { profiles, order };
}
