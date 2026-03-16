import { loadConfig } from "../../cli/config.js";

export async function runRepoListCommand(): Promise<void> {
  const config = loadConfig();
  const entries = Object.values(config.projects ?? {}).sort((a, b) => a.repo.localeCompare(b.repo));

  if (entries.length === 0) {
    console.log("[reviewflux] no repositories configured");
    return;
  }

  console.log("[reviewflux] configured repositories:");
  for (const repoConfig of entries) {
    const model = repoConfig.model ? `${repoConfig.model.provider}/${repoConfig.model.model}` : (repoConfig.modelAlias ?? "<default>");
    const contextInfo =
      repoConfig.context?.mode === "custom"
        ? `custom:${(repoConfig.context.include ?? []).join(",")}`
        : "default:AGENTS.md";
    console.log(
      `- ${repoConfig.repo} | mode=${repoConfig.pr.mode} | model=${model} | context=${contextInfo}`,
    );
  }
}
