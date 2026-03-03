import { loadConfig } from "../../cli/config.js";

export async function runProjectListCommand(): Promise<void> {
  const config = loadConfig();
  const entries = Object.values(config.projects ?? {}).sort((a, b) => a.repo.localeCompare(b.repo));

  if (entries.length === 0) {
    console.log("[reviewflux] no projects configured");
    return;
  }

  console.log("[reviewflux] configured projects:");
  for (const project of entries) {
    const model = project.modelAlias ?? "<default>";
    const contextInfo =
      project.context?.mode === "custom"
        ? `custom:${(project.context.include ?? []).join(",")}`
        : "default:AGENTS.md";
    console.log(
      `- ${project.repo} | mode=${project.pr.mode} | model=${model} | context=${contextInfo}`,
    );
  }
}
