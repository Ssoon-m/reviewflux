import type { AppConfig } from "../config/env.js";
import { createLlmProvider } from "./factory.js";
import { resolveRequestedModelRef } from "./model-policy.js";
import type { LlmProvider } from "./types.js";
import { resolveAuthInput } from "./auth-resolver.js";

export { parseModelAliasesJson } from "./model-policy.js";

export function createLlmService(config: AppConfig): LlmProvider {
  const modelRef = resolveRequestedModelRef(config);
  const authInput = resolveAuthInput({
    config,
    provider: modelRef.provider,
    model: modelRef.model,
  });

  return createLlmProvider(authInput);
}
