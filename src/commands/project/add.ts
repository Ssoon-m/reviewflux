import { promptSelect, promptText } from "../../cli/clack-prompter.js";
import { loadConfig, saveConfig, type ReviewFluxConfig } from "../../cli/config.js";
import { normalizeRepoInput, type PrReviewMode } from "./shared.js";
import { existsSync, statSync } from "node:fs";

function upsertRepoPolicy(config: ReviewFluxConfig, repo: string, modelAlias?: string): void {
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

function resolveModelAliasSelection(config: ReviewFluxConfig): Promise<string | undefined> {
  const aliases = Object.keys(config.modelAliases ?? {}).sort((a, b) => a.localeCompare(b));
  if (aliases.length === 0) return Promise.resolve(undefined);

  return promptSelect<string>({
    message: "Project model",
    options: [
      { label: "Use default model", value: "__default__" },
      ...aliases.map((alias) => ({ label: alias, value: alias })),
    ],
    initialValue: "__default__",
  }).then((value) => (value === "__default__" ? undefined : value));
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

  const workspaceDir = (await promptText({
    message: "Local repository path for markdown context",
    initialValue: process.cwd(),
    placeholder: "/Users/you/dev/repo",
  })).trim();
  if (!existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
    throw new Error(`workspace_dir_not_found:${workspaceDir}`);
  }

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

  const modelAlias = await resolveModelAliasSelection(config);

  const projects = { ...(config.projects ?? {}) };
  projects[repo] = {
    repo,
    workspaceDir,
    ...(modelAlias ? { modelAlias } : {}),
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
  upsertRepoPolicy(config, repo, modelAlias);
  saveConfig(config);

  console.log(`[reviewflux] project added: ${repo}`);
  console.log(`[reviewflux] pr mode: ${mode}`);
  console.log(`[reviewflux] workspace: ${workspaceDir}`);
  if (contextMode === "default") {
    console.log("[reviewflux] context: AGENTS.md");
  } else {
    console.log(`[reviewflux] context: ${(customPatterns ?? ["AGENTS.md"]).join(", ")}`);
  }
  if (modelAlias) {
    console.log(`[reviewflux] project model alias: ${modelAlias}`);
  } else {
    console.log("[reviewflux] project model alias: <default>");
  }
  console.log("[reviewflux] force command is always enabled: @reviewflux");
}
