import { getProviders } from "@mariozechner/pi-ai";
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
  const mapped = PROVIDER_ALIASES[normalized] ?? normalized;

  if (PROVIDER_ALIASES[normalized]) {
    return mapped;
  }

  if (getProviders().includes(mapped as never)) {
    return mapped;
  }

  throw new Error(`unsupported_provider:${raw}`);
}
