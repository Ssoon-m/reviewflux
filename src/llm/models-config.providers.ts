import { getModels, getProviders } from "@mariozechner/pi-ai";
import type { LlmProviderName } from "./types.js";

/**
 * Model catalog and support checks depend only on pi-ai:
 * - getProviders() / getModels(provider) define the catalog.
 * - getModel(provider, model) is the final authority for runtime support.
 * No static model list is maintained here
 * (alias, allowlist, parsing) while keeping the catalog source as pi-ai.
 */

export type OpenAIModelId = string;
export type GeminiModelId = string;

export type KnownModelIdByProvider = Record<string, string>;

export type KnownModelRef = { provider: string; model: string };

export type ProviderModelCatalog = Record<LlmProviderName, Set<string>>;

/** Normalize user-facing model id to the id pi-ai expects. Expand here for provider-specific aliases (e.g. openclaw-style gemini-3-pro → gemini-3-pro-preview). */
export function normalizeProviderModelId(
  provider: LlmProviderName,
  model: string,
): string {
  const trimmed = model.trim();
  if (provider === "google" || provider === "gemini") {
    if (trimmed === "gemini-3-pro") return "gemini-3-pro-preview";
    if (trimmed === "gemini-3-flash") return "gemini-3-flash-preview";
  }
  return trimmed;
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
  return (
    params.catalog[params.provider]?.has(
      normalizeProviderModelId(params.provider, params.model),
    ) ?? false
  );
}

export function isKnownModelId<P extends LlmProviderName>(
  _provider: P,
  _model: string,
): _model is KnownModelIdByProvider[P] {
  return true;
}
