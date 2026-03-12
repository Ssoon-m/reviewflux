import { promptSelect, promptText } from "../../cli/clack-prompter.js";
import { loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";
import {
  normalizeRepoInput,
  type PrReviewMode,
} from "../../project/input.js";
import { getSelectableModelsForProvider } from "../../llm/provider-catalog.js";
import { ensureProviderCredentials, pickProjectProvider } from "./shared.js";

async function resolveProjectModelSelection(
  config: ReviewFluxConfig,
): Promise<{ provider: string; model: string } | undefined> {
  const mode = await promptSelect<"__default__" | "__project__">({
    message: "Project model",
    options: [
      { label: "Use default model", value: "__default__" },
      { label: "Select project model", value: "__project__" },
    ],
    initialValue: "__default__",
  });

  if (mode === "__default__") return undefined;

  const selectedProvider = await pickProjectProvider(config.llm);
  await ensureProviderCredentials(config, selectedProvider);

  const models = getSelectableModelsForProvider(selectedProvider);
  if (models.length === 0) return undefined;

  const selectedModel = await promptSelect<string>({
    message: "Select project model",
    options: models.map((model) => ({ label: `${model.id} (${model.name})`, value: model.id })),
    initialValue: selectedProvider === config.llm ? (config.model ?? models[0]?.id) : models[0]?.id,
  });

  if (selectedProvider === config.llm && selectedModel === config.model) {
    return undefined;
  }

  return {
    provider: selectedProvider,
    model: selectedModel,
  };
}

export async function runProjectAddCommand(): Promise<void> {
  const config = loadConfig();

  const repoInput = await promptText({
    message: "GitHub repository (owner/repo or URL)",
    placeholder: "Ssoon-m/reviewflux",
  });
  const repo = normalizeRepoInput(repoInput);

  const mode = (await promptSelect<PrReviewMode>({
    message: "PR review trigger mode",
    options: [
      { label: "Run once on PR open", value: "opened_once" },
      { label: "Run on PR open + each push", value: "on_push" },
    ],
    initialValue: "opened_once",
  })) as PrReviewMode;

  const contextMode = await promptSelect<"default" | "custom">({
    message: "Review context files",
    options: [
      { label: "Default (AGENTS.md only)", value: "default" },
      { label: "Custom markdown patterns", value: "custom", hint: "Example: docs/review/*.md, guides/**/*.md" },
    ],
    initialValue: "default",
  });

  const customPatterns =
    contextMode === "custom"
      ? (await promptText({
          message: "Custom markdown patterns (comma-separated)",
          placeholder: "AGENTS.md, docs/review/*.md",
        }))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;

  const projectModel = await resolveProjectModelSelection(config);

  const projects = { ...(config.projects ?? {}) };
  projects[repo] = {
    repo,
    ...(projectModel ? { model: projectModel } : {}),
    pr: {
      mode,
      forceCommand: "@reviewflux",
    },
    context:
      contextMode === "custom"
        ? {
            mode: "custom",
            include: customPatterns && customPatterns.length > 0 ? customPatterns : ["AGENTS.md"],
          }
        : { mode: "default" },
  };

  config.projects = projects;
  saveConfig(config);

  console.log(`[reviewflux] project added: ${repo}`);
  console.log(`[reviewflux] pr mode: ${mode}`);
  if (contextMode === "default") {
    console.log("[reviewflux] context: AGENTS.md");
  } else {
    console.log(`[reviewflux] context: ${(customPatterns ?? ["AGENTS.md"]).join(", ")}`);
  }
  if (projectModel) {
    console.log(`[reviewflux] project model: ${projectModel.provider}/${projectModel.model}`);
  } else {
    console.log("[reviewflux] project model: <default>");
  }
  console.log("[reviewflux] force command is always enabled: @reviewflux");
}
