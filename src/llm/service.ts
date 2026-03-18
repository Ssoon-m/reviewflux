import type { AppConfig } from "../config/env";
import { createLlmProvider } from "./factory";
import { resolveRequestedModelRef, parseModelAliasesJson } from "./model-selection";
import type { LlmProvider } from "./types";
import { resolveAuthInput } from "./auth-resolver";

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
