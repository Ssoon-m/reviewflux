import { promptText } from "../../cli/clack-prompter.js";
import { loadConfig, saveConfig } from "../../cli/config.js";
import { normalizeRepoInput } from "../../lib/repo/input.js";

export async function runRepoRemoveCommand(): Promise<void> {
  const config = loadConfig();

  const repoInput = await promptText({
    message: "Repository to remove (owner/repo or URL)",
    placeholder: "Ssoon-m/reviewflux",
  });
  const repo = normalizeRepoInput(repoInput);

  const repoConfigs = { ...(config.projects ?? {}) };
  if (!repoConfigs[repo]) {
    throw new Error(`repo_not_found:${repo}`);
  }

  delete repoConfigs[repo];
  config.projects = Object.keys(repoConfigs).length > 0 ? repoConfigs : undefined;

  if (config.repoModelPolicies?.[repo]) {
    const nextPolicies = { ...config.repoModelPolicies };
    delete nextPolicies[repo];
    config.repoModelPolicies = Object.keys(nextPolicies).length > 0 ? nextPolicies : undefined;
  }

  saveConfig(config);
  console.log(`[reviewflux] repository removed: ${repo}`);
}
