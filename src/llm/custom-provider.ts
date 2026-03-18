/**
 * Custom provider: arbitrary OpenAI- or Anthropic-compatible endpoint.
 * Responsibility: validation and normalisation only (no CLI, no I/O).
 */

export type CustomCompatibility = "openai" | "anthropic";

export type CustomProviderConfig = {
  baseUrl: string;
  modelId: string;
  compatibility: CustomCompatibility;
  apiKey?: string;
};

export const CUSTOM_PROVIDER_ID_OPENAI = "custom-openai";
export const CUSTOM_PROVIDER_ID_ANTHROPIC = "custom-anthropic";

export function getCustomProviderId(compatibility: CustomCompatibility): string {
  return compatibility === "anthropic" ? CUSTOM_PROVIDER_ID_ANTHROPIC : CUSTOM_PROVIDER_ID_OPENAI;
}

export function isCustomProviderId(provider: string): boolean {
  const n = provider.trim().toLowerCase();
  return n === CUSTOM_PROVIDER_ID_OPENAI || n === CUSTOM_PROVIDER_ID_ANTHROPIC;
}

/** Normalise base URL for chat endpoint (strip trailing slash, ensure path). */
export function normalizeCustomBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("custom_provider_base_url_required");
  try {
    const u = new URL(trimmed);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("custom_provider_base_url_http_https");
    return trimmed;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("custom_provider")) throw e;
    throw new Error("custom_provider_base_url_invalid", { cause: e });
  }
}

export function normalizeCustomModelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("custom_provider_model_id_required");
  return trimmed;
}

export function parseCustomCompatibility(raw: string): CustomCompatibility {
  const n = raw.trim().toLowerCase();
  if (n === "anthropic") return "anthropic";
  if (n === "openai" || n === "") return "openai";
  throw new Error('custom_provider_compatibility_invalid (use "openai" or "anthropic")');
}

export function validateCustomProviderConfig(params: {
  baseUrl: string;
  modelId: string;
  compatibility: string;
  apiKey?: string;
}): CustomProviderConfig {
  return {
    baseUrl: normalizeCustomBaseUrl(params.baseUrl),
    modelId: normalizeCustomModelId(params.modelId),
    compatibility: parseCustomCompatibility(params.compatibility),
    apiKey: params.apiKey?.trim() || undefined,
  };
}
