export type LlmProviderId = "openai-codex" | "openai" | "google" | "anthropic";

export type TaskKey = "review" | "autofix" | "summary" | "default";

export type ModelTarget = {
  provider: LlmProviderId;
  model: string;
};

export type ModelAliasMap = Record<string, ModelTarget>;

export type RepoModelPolicy = {
  defaultAlias?: string;
  taskAliases?: Partial<Record<TaskKey, string>>;
};

export type RoutingConfig = {
  defaultAlias: string;
  aliases: ModelAliasMap;
  repoPolicies?: Record<string, RepoModelPolicy>;
};

export type ResolveModelInput = {
  task?: TaskKey;
  repo?: string;
  aliasOverride?: string;
};

export function normalizeRepoKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function resolveAlias(config: RoutingConfig, input: ResolveModelInput): string {
  if (input.aliasOverride) return input.aliasOverride;

  if (input.repo) {
    const policy = config.repoPolicies?.[normalizeRepoKey(input.repo)];
    const taskAlias = input.task ? policy?.taskAliases?.[input.task] : undefined;
    if (taskAlias) return taskAlias;
    if (policy?.defaultAlias) return policy.defaultAlias;
  }

  return config.defaultAlias;
}

export function resolveModel(config: RoutingConfig, input: ResolveModelInput = {}): ModelTarget {
  const alias = resolveAlias(config, input);
  const target = config.aliases[alias];
  if (!target) {
    throw new Error(`llm_alias_not_found:${alias}`);
  }
  return target;
}
