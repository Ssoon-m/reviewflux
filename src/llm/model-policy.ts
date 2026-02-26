import type { AppConfig } from "../config/env.js";
import { resolveModelRef, type ModelAliasMap, type ModelRef } from "./model-ref.js";
import { normalizeProviderId } from "./provider-normalizer.js";

export function parseModelAliasesJson(raw?: string): ModelAliasMap {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as Record<string, { provider: string; model: string }>;
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), { provider: normalizeProviderId(v.provider), model: v.model }]),
  );
}

export function parseAllowedModelsCsv(raw?: string): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function resolveRequestedModelRef(config: AppConfig): ModelRef {
  const aliases = parseModelAliasesJson(config.LLM_MODEL_ALIASES_JSON);
  const ref = resolveModelRef({
    raw: config.LLM_MODEL,
    defaultProvider: normalizeProviderId(config.LLM_PROVIDER),
    aliases,
  });

  const allowlist = parseAllowedModelsCsv(config.LLM_ALLOWED_MODELS);
  if (allowlist.size === 0) return ref;

  const key = `${ref.provider}/${ref.model}`.toLowerCase();
  if (!allowlist.has(key)) {
    throw new Error(`model_not_allowed:${key}`);
  }

  return ref;
}
