import { promptSelect, promptText } from "../../cli/clack-prompter.js";
import { loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";
import { normalizeRepoInput } from "./shared.js";

function updateRepoPolicy(config: ReviewFluxConfig, repo: string, modelAlias?: string): void {
  const nextPolicies = { ...(config.repoModelPolicies ?? {}) };
  const existing = nextPolicies[repo] ?? {};

  if (modelAlias) {
    nextPolicies[repo] = { ...existing, defaultAlias: modelAlias };
  } else if (existing.taskAliases) {
    nextPolicies[repo] = { taskAliases: existing.taskAliases };
  } else {
    delete nextPolicies[repo];
  }

  config.repoModelPolicies = Object.keys(nextPolicies).length > 0 ? nextPolicies : undefined;
}

async function pickAlias(config: ReviewFluxConfig): Promise<string | undefined> {
  const aliases = Object.keys(config.modelAliases ?? {}).sort((a, b) => a.localeCompare(b));
  if (aliases.length === 0) {
    return undefined;
  }

  const selected = await promptSelect<string>({
    message: "Set project model",
    options: [
      { label: "Use default model", value: "__default__" },
      ...aliases.map((alias) => ({ label: alias, value: alias })),
    ],
    initialValue: "__default__",
  });

  return selected === "__default__" ? undefined : selected;
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

  const alias = await pickAlias(config);
  const nextProject = {
    ...target,
    ...(alias ? { modelAlias: alias } : {}),
  };
  if (!alias) {
    delete nextProject.modelAlias;
  }
  projects[repo] = nextProject;

  config.projects = projects;
  updateRepoPolicy(config, repo, alias);
  saveConfig(config);

  console.log(`[reviewflux] project model updated: ${repo}`);
  console.log(`[reviewflux] model alias: ${alias ?? "<default>"}`);
}
