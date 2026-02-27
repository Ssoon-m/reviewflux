import type { AppConfig } from "../config/env.js";
import { createLlmProvider } from "./factory.js";
import { resolveRequestedModelRef, parseModelAliasesJson } from "./model-selection.js";
import type { LlmProvider } from "./types.js";
import { resolveAuthInput } from "./auth-resolver.js";

export { parseModelAliasesJson };

export function createLlmService(config: AppConfig): LlmProvider {
  const modelRef = resolveRequestedModelRef(config);
  const authInput = resolveAuthInput({
    config,
    provider: modelRef.provider,
    model: modelRef.model,
  });

  return createLlmProvider(authInput);
}
