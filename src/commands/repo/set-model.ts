import { promptSelect, promptText } from "../../cli/clack-prompter";
import { loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config";
import { normalizeRepoInput } from "../../lib/repo/input";
import { getSelectableModelsForProvider } from "../../llm/provider-catalog";
import { ensureProviderCredentials, pickRepoProvider } from "./shared";

function resolveLegacyRepoModel(params: {
  config: ReviewFluxConfig;
  modelAlias?: string;
}): { provider: string; model: string } | undefined {
  if (!params.modelAlias) return undefined;
  return params.config.modelAliases?.[params.modelAlias];
}

async function pickRepoModel(
  config: ReviewFluxConfig,
  currentModel?: { provider: string; model: string },
): Promise<{ provider: string; model: string } | undefined> {
  const mode = await promptSelect<"__default__" | "__repo__">({
    message: "Set repository model",
    options: [
      { label: "Use default model", value: "__default__" },
      { label: "Select repository model", value: "__repo__" },
    ],
    initialValue: currentModel ? "__repo__" : "__default__",
  });

  if (mode === "__default__") return undefined;

  const selectedProvider = await pickRepoProvider(currentModel?.provider ?? config.llm);
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
    message: "Select repository model",
    options: models.map((model) => ({ label: `${model.id} (${model.name})`, value: model.id })),
    initialValue: initialModel,
  });

  if (selectedProvider === config.llm && selectedModel === config.model) return undefined;
  return {
    provider: selectedProvider,
    model: selectedModel,
  };
}

export async function runRepoSetModelCommand(): Promise<void> {
  const config = loadConfig();

  const repoInput = await promptText({
    message: "Repository (owner/repo or URL)",
    placeholder: "Ssoon-m/reviewflux",
  });
  const repo = normalizeRepoInput(repoInput);

  const repoConfigs = { ...(config.projects ?? {}) };
  const target = repoConfigs[repo];
  if (!target) throw new Error(`repo_not_found:${repo}`);

  const currentModel = target.model ?? resolveLegacyRepoModel({ config, modelAlias: target.modelAlias });
  const repoModel = await pickRepoModel(config, currentModel);
  const nextRepo = {
    ...target,
    ...(repoModel ? { model: repoModel } : {}),
  };
  if (repoModel) {
    delete nextRepo.modelAlias;
  }
  if (!repoModel) {
    delete nextRepo.model;
    delete nextRepo.modelAlias;
  }
  repoConfigs[repo] = nextRepo;

  config.projects = repoConfigs;
  saveConfig(config);

  console.log(`[reviewflux] repository model updated: ${repo}`);
  console.log(`[reviewflux] model: ${repoModel ? `${repoModel.provider}/${repoModel.model}` : "<default>"}`);
}
