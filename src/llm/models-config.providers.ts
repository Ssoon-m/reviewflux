import { MODELS } from "@mariozechner/pi-ai/dist/models.generated.js";
import type { AppConfig } from "../config/env.js";
import { normalizeProviderId } from "./provider-normalizer.js";
import type { LlmProviderName } from "./types.js";

export type OpenAIModelId = (keyof (typeof MODELS)["openai"]) & string;
export type GeminiModelId = (keyof (typeof MODELS)["google"]) & string;

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

export function defaultProviderModelCatalog(): ProviderModelCatalog {
  return {
    openai: new Set(Object.keys(MODELS.openai)),
    gemini: new Set(Object.keys(MODELS.google).map((id) => normalizeProviderModelId("gemini", id))),
  };
}

export function parseProviderModelsJson(raw?: string): Partial<Record<LlmProviderName, string[]>> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as Record<string, string[]>;

  const out: Partial<Record<LlmProviderName, string[]>> = {};
  for (const [providerRaw, models] of Object.entries(parsed)) {
    const provider = normalizeProviderId(providerRaw);
    if (!Array.isArray(models)) continue;
    out[provider] = models.filter((v): v is string => typeof v === "string");
  }

  return out;
}

export function resolveProviderModelCatalog(config: AppConfig): ProviderModelCatalog {
  const catalog = defaultProviderModelCatalog();
  const custom = parseProviderModelsJson(config.LLM_PROVIDER_MODELS_JSON);

  for (const [provider, models] of Object.entries(custom) as Array<[LlmProviderName, string[]]>) {
    if (!models || models.length === 0) continue;
    for (const model of models) {
      catalog[provider].add(normalizeProviderModelId(provider, model));
    }
  }

  return catalog;
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
    return model in MODELS.openai;
  }
  const normalized = normalizeProviderModelId("gemini", model);
  return normalized in MODELS.google;
}
