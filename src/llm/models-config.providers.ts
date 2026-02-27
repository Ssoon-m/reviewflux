import { MODELS } from "@mariozechner/pi-ai/dist/models.generated.js";
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
    return model in MODELS.openai;
  }
  const normalized = normalizeProviderModelId("gemini", model);
  return normalized in MODELS.google;
}
