import { getModels, getProviders } from "@mariozechner/pi-ai";
import type { LlmProviderName } from "./types.js";

export type OpenAIModelId = string;
export type GeminiModelId = string;

export type KnownModelIdByProvider = Record<string, string>;

export type KnownModelRef = { provider: string; model: string };

export type ProviderModelCatalog = Record<LlmProviderName, Set<string>>;

export function normalizeProviderModelId(_provider: LlmProviderName, model: string): string {
  return model.trim();
}

function getProviderModelKeys(provider: string): string[] {
  return getModels(provider as never).map((model) => model.id);
}

export function defaultProviderModelCatalog(): ProviderModelCatalog {
  const catalog: ProviderModelCatalog = {};
  for (const provider of getProviders()) {
    catalog[provider] = new Set(getProviderModelKeys(provider));
  }

  // Backward-compat aliases used by existing config/tests.
  if (!catalog.gemini && catalog.google) {
    catalog.gemini = new Set(catalog.google);
  }

  if (!catalog.codex && catalog["openai-codex"]) {
    catalog.codex = new Set(catalog["openai-codex"]);
  }

  return catalog;
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

export function isKnownModelId<P extends LlmProviderName>(_provider: P, _model: string): _model is KnownModelIdByProvider[P] {
  return true;
}
