import type { LlmProviderName } from "./types.js";

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
    const provider = trimmed.slice(0, slash) as LlmProviderName;
    const model = trimmed.slice(slash + 1);
    if ((provider === "openai" || provider === "gemini") && model) {
      return { provider, model };
    }
  }

  return { provider: params.defaultProvider, model: trimmed };
}
