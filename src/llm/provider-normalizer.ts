import type { LlmProviderName } from "./types.js";

const PROVIDER_ALIASES: Record<string, LlmProviderName> = {
  openai: "openai",
  "openai-codex": "openai",
  codex: "openai",
  google: "gemini",
  gemini: "gemini",
};

export function normalizeProviderId(raw: string): LlmProviderName {
  const normalized = raw.trim().toLowerCase();
  const mapped = PROVIDER_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`unsupported_provider:${raw}`);
  }
  return mapped;
}
