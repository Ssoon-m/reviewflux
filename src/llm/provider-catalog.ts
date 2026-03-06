import { getModels, getProviders } from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";

export type ProviderGroup = {
  groupKey: string;
  groupLabel: string;
  providers: string[];
  hint?: string;
};

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

export function groupKeyOfProvider(provider: string): string {
  return provider.includes("-") ? provider.split("-")[0]! : provider;
}

export function getProviderChoiceLabel(providerId: string): string {
  if (providerId === "google") return "Google Gemini API key";
  if (providerId === "google-gemini-cli") return "Google Gemini CLI OAuth";
  const oauth = getOAuthProviders().find((p) => p.id === providerId);
  if (oauth) return oauth.name;
  if (providerId === "openai") return "OpenAI API key";
  return providerId;
}

export function getProviderChoiceHint(providerId: string): string | undefined {
  if (providerId === "google-gemini-cli") {
    return "Unofficial flow; review account-risk warning before use";
  }
  return undefined;
}

export function getProviderGroupsForSelection(): ProviderGroup[] {
  const oauthIds = new Set(getOAuthProviders().map((p) => p.id));
  const excludedInSetup = new Set(["google-antigravity", "google-vertex"]);
  const all = getProviders()
    .filter((id) => !excludedInSetup.has(String(id)))
    .map((id) => String(id))
    .sort((a, b) => a.localeCompare(b));

  const byGroup = new Map<string, string[]>();
  for (const id of all) {
    const key = groupKeyOfProvider(id);
    const list = byGroup.get(key) ?? [];
    list.push(id);
    byGroup.set(key, list);
  }

  return Array.from(byGroup.entries())
    .map(([key, providers]) => {
      const sorted = providers.sort((a, b) => a.localeCompare(b));
      const hasOAuth = sorted.some((provider) => oauthIds.has(provider));
      const hasApikey = sorted.some((provider) => !oauthIds.has(provider));
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

export function getSelectableModelsForProvider(provider: string): Array<{ id: string; name: string }> {
  return getModels(provider as never)
    .map((model) => ({ id: model.id, name: model.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
