import { getModel, supportsXhigh } from "@mariozechner/pi-ai";
import type { AuthMode, EffortLevel } from "../cli/config.js";

const BASE_LEVELS: EffortLevel[] = ["low", "medium", "high"];

function resolvePiProviderForCodex(authMode: AuthMode): "openai" | "openai-codex" {
  return authMode === "oauth" ? "openai-codex" : "openai";
}

export function getCodexEffortLevels(params: { authMode: AuthMode; model: string }): EffortLevel[] {
  const provider = resolvePiProviderForCodex(params.authMode);
  const model = getModel(provider, params.model as never);

  if (!model?.reasoning) return ["low"];

  if (supportsXhigh(model)) {
    return [...BASE_LEVELS, "xhigh"];
  }

  return BASE_LEVELS;
}

export function resolveCodexEffort(params: {
  authMode: AuthMode;
  model: string;
  requested?: EffortLevel;
}): EffortLevel {
  const allowed = getCodexEffortLevels({ authMode: params.authMode, model: params.model });
  const requested = params.requested ?? "medium";

  if (allowed.includes(requested)) return requested;
  return allowed[allowed.length - 1] ?? "medium";
}
