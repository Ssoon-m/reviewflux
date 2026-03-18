import { normalizeProviderId } from "./provider-normalizer";
import type { LlmProviderName } from "./types";

export type ModelRef = {
  provider: LlmProviderName;
  model: string;
};

export type ModelAliasMap = Record<string, ModelRef>;

export function resolveModelRef(params: {
  raw: string;
  defaultProvider: LlmProviderName;
  aliases?: ModelAliasMap;
}): ModelRef {
  const trimmed = params.raw.trim();
  if (!trimmed) throw new Error("model_required");

  const aliasTarget = params.aliases?.[trimmed.toLowerCase()];
  if (aliasTarget) return aliasTarget;

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const providerRaw = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1);
    if (model) {
      return { provider: normalizeProviderId(providerRaw), model };
    }
  }

  return { provider: normalizeProviderId(params.defaultProvider), model: trimmed };
}
