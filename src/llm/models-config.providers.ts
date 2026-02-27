import { MODELS } from "@mariozechner/pi-ai/dist/models.generated.js";
import type { LlmProviderName } from "./types.js";

type ProviderModels<TKey extends string> =
  TKey extends keyof typeof MODELS ? (typeof MODELS)[TKey] : Record<never, never>;

export type OpenAIModelId = (keyof ProviderModels<"openai">) & string;
export type GeminiModelId = (keyof ProviderModels<"google">) & string;

export type KnownModelIdByProvider = {
  openai: OpenAIModelId;
  gemini: GeminiModelId;
};

export type KnownModelRef =
  | { provider: "openai"; model: OpenAIModelId }
  | { provider: "gemini"; model: GeminiModelId };

export type ProviderModelCatalog = Record<LlmProviderName, Set<string>>;

export function normalizeProviderModelId(_provider: LlmProviderName, model: string): string {
  return model.trim();
}

function getProviderModelKeys(provider: string): string[] {
  const table = MODELS as Record<string, Record<string, unknown>>;
  const providerModels = table[provider];
  if (!providerModels || typeof providerModels !== "object") {
    return [];
  }
  return Object.keys(providerModels);
}

export function defaultProviderModelCatalog(): ProviderModelCatalog {
  return {
    openai: new Set(getProviderModelKeys("openai")),
    gemini: new Set(getProviderModelKeys("google").map((id) => normalizeProviderModelId("gemini", id))),
  };
}

export function resolveProviderModelCatalog(): ProviderModelCatalog {
  return defaultProviderModelCatalog();
}

export function isModelSupported(params: {
  catalog: ProviderModelCatalog;
  provider: LlmProviderName;
  model: string;
}): boolean {
  return params.catalog[params.provider]?.has(normalizeProviderModelId(params.provider, params.model)) ?? false;
}

export function isKnownModelId<P extends LlmProviderName>(
  provider: P,
  model: string,
): model is KnownModelIdByProvider[P] {
  if (provider === "openai") {
    return getProviderModelKeys("openai").includes(model);
  }
  const normalized = normalizeProviderModelId("gemini", model);
  return getProviderModelKeys("google").includes(normalized);
}
