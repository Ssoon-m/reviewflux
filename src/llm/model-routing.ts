import { normalizeRepoKey } from "../project/input.js";

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

export class ModelCatalog {
  constructor(private readonly aliases: ModelAliasMap) {}

  getByAlias(alias: string): ModelTarget {
    const target = this.aliases[alias];
    if (!target) throw new Error(`llm_alias_not_found:${alias}`);
    return target;
  }
}

export class RepoPolicyStore {
  private readonly policies: Record<string, RepoModelPolicy>;

  constructor(policies?: Record<string, RepoModelPolicy>) {
    this.policies = Object.fromEntries(
      Object.entries(policies ?? {}).map(([key, value]) => [normalizeRepoKey(key), value]),
    );
  }

  get(repo?: string): RepoModelPolicy | undefined {
    if (!repo) return undefined;
    return this.policies[normalizeRepoKey(repo)];
  }
}

export class ModelRouter {
  private readonly catalog: ModelCatalog;
  private readonly policyStore: RepoPolicyStore;

  constructor(private readonly config: RoutingConfig) {
    this.catalog = new ModelCatalog(config.aliases);
    this.policyStore = new RepoPolicyStore(config.repoPolicies);
  }

  resolve(input: ResolveModelInput = {}): ModelTarget {
    const alias = this.resolveAlias(input);
    return this.catalog.getByAlias(alias);
  }

  private resolveAlias(input: ResolveModelInput): string {
    if (input.aliasOverride) return input.aliasOverride;

    const policy = this.policyStore.get(input.repo);
    const taskAlias = input.task ? policy?.taskAliases?.[input.task] : undefined;
    if (taskAlias) return taskAlias;
    if (policy?.defaultAlias) return policy.defaultAlias;

    return this.config.defaultAlias;
  }
}

export function resolveModel(config: RoutingConfig, input: ResolveModelInput = {}): ModelTarget {
  return new ModelRouter(config).resolve(input);
}
