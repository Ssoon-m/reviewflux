import { getProviders } from "@mariozechner/pi-ai";
import type { LlmProviderName } from "./types";
import { isCustomProviderId } from "./custom-provider";

/** Normalize and validate provider id: pi-ai getProviders() or custom-openai/custom-anthropic. */
export function normalizeProviderId(raw: string): LlmProviderName {
  const normalized = raw.trim().toLowerCase();
  if (isCustomProviderId(normalized)) return normalized as LlmProviderName;
  if (getProviders().includes(normalized as never)) return normalized as LlmProviderName;
  throw new Error(`unsupported_provider:${raw}`);
}
