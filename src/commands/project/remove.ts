import { promptText } from "../../cli/clack-prompter.js";
import { loadConfig, saveConfig } from "../../cli/config.js";
import { normalizeRepoInput } from "./shared.js";

export async function runProjectRemoveCommand(): Promise<void> {
  const config = loadConfig();

  const repoInput = await promptText({
    message: "Repository to remove (owner/repo or URL)",
    placeholder: "Ssoon-m/reviewflux",
  });
  const repo = normalizeRepoInput(repoInput);

  const projects = { ...(config.projects ?? {}) };
  if (!projects[repo]) {
    throw new Error(`project_not_found:${repo}`);
  }

  delete projects[repo];
  config.projects = Object.keys(projects).length > 0 ? projects : undefined;

  if (config.repoModelPolicies?.[repo]) {
    const nextPolicies = { ...config.repoModelPolicies };
    delete nextPolicies[repo];
    config.repoModelPolicies = Object.keys(nextPolicies).length > 0 ? nextPolicies : undefined;
  }

  saveConfig(config);
  console.log(`[reviewflux] project removed: ${repo}`);
}
