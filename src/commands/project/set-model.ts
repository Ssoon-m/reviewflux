import { promptSelect, promptText } from "../../cli/clack-prompter.js";
import { loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";
import { getSelectableModelsForProvider } from "../../llm/provider-catalog.js";
import { ensureProviderCredentials, normalizeRepoInput, pickProjectProvider } from "./shared.js";

function resolveLegacyProjectModel(params: {
  config: ReviewFluxConfig;
  modelAlias?: string;
}): { provider: string; model: string } | undefined {
  if (!params.modelAlias) return undefined;
  return params.config.modelAliases?.[params.modelAlias];
}

async function pickProjectModel(
  config: ReviewFluxConfig,
  currentModel?: { provider: string; model: string },
): Promise<{ provider: string; model: string } | undefined> {
  const mode = await promptSelect<"__default__" | "__project__">({
    message: "Set project model",
    options: [
      { label: "Use default model", value: "__default__" },
      { label: "Select project model", value: "__project__" },
    ],
    initialValue: currentModel ? "__project__" : "__default__",
  });

  if (mode === "__default__") return undefined;

  const selectedProvider = await pickProjectProvider(currentModel?.provider ?? config.llm);
  await ensureProviderCredentials(config, selectedProvider);

  const models = getSelectableModelsForProvider(selectedProvider);
  if (models.length === 0) return undefined;

  const initialModel =
    currentModel?.provider === selectedProvider
      ? currentModel.model
      : selectedProvider === config.llm
        ? (config.model ?? models[0]?.id)
        : models[0]?.id;

  const selectedModel = await promptSelect<string>({
    message: "Select project model",
    options: models.map((model) => ({ label: `${model.id} (${model.name})`, value: model.id })),
    initialValue: initialModel,
  });

  if (selectedProvider === config.llm && selectedModel === config.model) return undefined;
  return {
    provider: selectedProvider,
    model: selectedModel,
  };
}

export async function runProjectSetModelCommand(): Promise<void> {
  const config = loadConfig();

  const repoInput = await promptText({
    message: "Repository (owner/repo or URL)",
    placeholder: "Ssoon-m/reviewflux",
  });
  const repo = normalizeRepoInput(repoInput);

  const projects = { ...(config.projects ?? {}) };
  const target = projects[repo];
  if (!target) throw new Error(`project_not_found:${repo}`);

  const currentModel = target.model ?? resolveLegacyProjectModel({ config, modelAlias: target.modelAlias });
  const projectModel = await pickProjectModel(config, currentModel);
  const nextProject = {
    ...target,
    ...(projectModel ? { model: projectModel } : {}),
  };
  if (projectModel) {
    delete nextProject.modelAlias;
  }
  if (!projectModel) {
    delete nextProject.model;
    delete nextProject.modelAlias;
  }
  projects[repo] = nextProject;

  config.projects = projects;
  saveConfig(config);

  console.log(`[reviewflux] project model updated: ${repo}`);
  console.log(`[reviewflux] model: ${projectModel ? `${projectModel.provider}/${projectModel.model}` : "<default>"}`);
}
