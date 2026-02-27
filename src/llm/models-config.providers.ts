import type { AppConfig } from "../config/env.js";
import { normalizeProviderId } from "./provider-normalizer.js";
import type { LlmProviderName } from "./types.js";

export type ProviderModelCatalog = Record<LlmProviderName, Set<string>>;

const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-5-codex",
  "gpt-5.3-codex",
] as const;

const GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.6-pro",
  "gemini-2.6-flash",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-preview",
] as const;

export function normalizeProviderModelId(provider: LlmProviderName, model: string): string {
  const trimmed = model.trim();
  if (provider !== "gemini") return trimmed;

  if (trimmed === "gemini-3-pro" || trimmed === "gemini-3.1-pro") return "gemini-3-pro-preview";
  if (trimmed === "gemini-3-flash" || trimmed === "gemini-3.1-flash") return "gemini-3-flash-preview";
  if (trimmed === "gemini-2.6") return "gemini-2.6-pro";

  return trimmed;
}

export function defaultProviderModelCatalog(): ProviderModelCatalog {
  return {
    openai: new Set(OPENAI_MODELS),
    gemini: new Set(GEMINI_MODELS),
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
