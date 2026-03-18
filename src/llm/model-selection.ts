import { getModel } from "@mariozechner/pi-ai";
import type { AppConfig } from "../config/env";
import { isCustomProviderId } from "./custom-provider";
import type { ModelRef } from "./model-ref";
import { isModelSupported, normalizeProviderModelId, resolveProviderModelCatalog } from "./models-config.providers";
import { normalizeProviderId } from "./provider-normalizer";

export type ModelAliasIndex = {
  byAlias: Map<string, ModelRef>;
};

export function modelKey(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

export function parseModelRef(raw: string, defaultProvider: string): ModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash < 0) {
    const provider = normalizeProviderId(defaultProvider);
    return { provider, model: normalizeProviderModelId(provider, trimmed) };
  }

  const providerRaw = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!providerRaw || !model) return null;

  const provider = normalizeProviderId(providerRaw);
  return { provider, model: normalizeProviderModelId(provider, model) };
}

export function parseModelAliasesJson(raw?: string): Record<string, ModelRef> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as Record<string, { provider: string; model: string }>;

  return Object.fromEntries(
    Object.entries(parsed).map(([alias, target]) => [alias.toLowerCase(), { provider: normalizeProviderId(target.provider), model: target.model }]),
  );
}

export function buildModelAliasIndex(aliases: Record<string, ModelRef>): ModelAliasIndex {
  const byAlias = new Map<string, ModelRef>();
  for (const [alias, ref] of Object.entries(aliases)) {
    byAlias.set(alias.trim().toLowerCase(), ref);
  }
  return { byAlias };
}

export function resolveModelRefFromString(params: {
  raw: string;
  defaultProvider: string;
  aliasIndex?: ModelAliasIndex;
}): ModelRef | null {
  const trimmed = params.raw.trim();
  if (!trimmed) return null;

  if (!trimmed.includes("/")) {
    const aliasMatch = params.aliasIndex?.byAlias.get(trimmed.toLowerCase());
    if (aliasMatch) return aliasMatch;
  }

  return parseModelRef(trimmed, params.defaultProvider);
}

export function parseAllowedModelsCsv(raw: string | undefined, defaultProvider: string): Set<string> {
  if (!raw?.trim()) return new Set();

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parsed = parseModelRef(entry, defaultProvider);
        return parsed ? modelKey(parsed).toLowerCase() : entry.toLowerCase();
      }),
  );
}

/** Use the provider id as the pi-ai provider (no hardcoded mapping). */
function resolvePiProvider(params: { provider: string; authMode: string }): string {
  return params.provider;
}

export function resolveRequestedModelRef(config: AppConfig): ModelRef {
  const aliases = parseModelAliasesJson(config.LLM_MODEL_ALIASES_JSON);
  const aliasIndex = buildModelAliasIndex(aliases);

  const resolved = resolveModelRefFromString({
    raw: config.LLM_MODEL,
    defaultProvider: config.LLM_PROVIDER,
    aliasIndex,
  });

  if (!resolved) {
    throw new Error(`invalid_model_reference:${config.LLM_MODEL}`);
  }

  if (!isCustomProviderId(resolved.provider)) {
    const catalog = resolveProviderModelCatalog();
    if (!isModelSupported({ catalog, provider: resolved.provider, model: resolved.model })) {
      throw new Error(`unsupported_model_for_provider:${resolved.provider}/${resolved.model}`);
    }

    const piProvider = resolvePiProvider({ provider: resolved.provider, authMode: config.LLM_AUTH_MODE });
    if (!getModel(piProvider as never, resolved.model as never)) {
      throw new Error(`model_not_supported_by_pi_ai:${piProvider}/${resolved.model}`);
    }
  }

  const allowlist = parseAllowedModelsCsv(config.LLM_ALLOWED_MODELS, config.LLM_PROVIDER);
  if (allowlist.size > 0) {
    const key = modelKey(resolved).toLowerCase();
    if (!allowlist.has(key)) {
      throw new Error(`model_not_allowed:${key}`);
    }
  }

  return resolved;
}
