import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dependencyCruiserBinPath = fileURLToPath(
  new URL("../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs", import.meta.url),
);

const DEFAULT_CONFIG_FILE = ".dependency-cruiser.cjs";
const UNKNOWN_IMPORT_RULE_MESSAGE = "Import violates a dependency-cruiser rule.";
const cruiseCache = new Map();

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function getContextCwd(context) {
  if (typeof context.getCwd === "function") {
    return context.getCwd();
  }

  if (typeof context.cwd === "string") {
    return context.cwd;
  }

  return process.cwd();
}

function getPhysicalFilename(context) {
  if (typeof context.getPhysicalFilename === "function") {
    return context.getPhysicalFilename();
  }

  if (typeof context.filename === "string") {
    return context.filename;
  }

  return "";
}

function getRelativeFilename(cwd, absoluteFilename) {
  if (!absoluteFilename || absoluteFilename.startsWith("<")) {
    return null;
  }

  const relativeFilename = toPosixPath(path.relative(cwd, absoluteFilename));
  if (
    !relativeFilename ||
    relativeFilename === "." ||
    relativeFilename.startsWith("../")
  ) {
    return null;
  }

  return relativeFilename;
}

function getCruiseTarget(relativeFilename) {
  const [topLevelSegment] = relativeFilename.split("/");
  if (!topLevelSegment) {
    return relativeFilename;
  }

  return relativeFilename.includes("/") ? topLevelSegment : relativeFilename;
}

function getFileMtimeMs(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function normalizeSettings(rawSettings, cwd) {
  const settings =
    typeof rawSettings === "object" && rawSettings !== null ? rawSettings : {};
  const configPath = path.resolve(
    cwd,
    typeof settings.config === "string" ? settings.config : DEFAULT_CONFIG_FILE,
  );
  const knownViolationsSetting =
    typeof settings.knownViolations === "string"
      ? settings.knownViolations
      : typeof settings.knownViolationsFile === "string"
        ? settings.knownViolationsFile
        : null;

  return {
    configPath,
    knownViolationsPath: knownViolationsSetting
      ? path.resolve(cwd, knownViolationsSetting)
      : null,
  };
}

function getCruiseCacheKey({
  cwd,
  configPath,
  knownViolationsPath,
  target,
}) {
  return [cwd, configPath, knownViolationsPath ?? "", target].join("::");
}

function getRuleCommentIndex(cruiseResult) {
  const commentsBySeverity = new Map();

  for (const rule of cruiseResult.summary?.ruleSetUsed?.forbidden ?? []) {
    const commentsForSeverity =
      commentsBySeverity.get(rule.severity) ?? new Map();
    commentsForSeverity.set(
      rule.name,
      rule.comment ?? UNKNOWN_IMPORT_RULE_MESSAGE,
    );
    commentsBySeverity.set(rule.severity, commentsForSeverity);
  }

  return commentsBySeverity;
}

function getModuleDependencyIndex(cruiseResult) {
  const dependenciesByModule = new Map();

  for (const module of cruiseResult.modules ?? []) {
    const dependencyIndex = new Map();

    for (const dependency of module.dependencies ?? []) {
      if (Array.isArray(dependency.rules) && dependency.rules.length > 0) {
        dependencyIndex.set(dependency.module, dependency.rules);
      }
    }

    dependenciesByModule.set(module.source, dependencyIndex);
  }

  return dependenciesByModule;
}

function runDependencyCruiser({
  cwd,
  configPath,
  knownViolationsPath,
  target,
}) {
  const args = [
    dependencyCruiserBinPath,
    "--config",
    path.relative(cwd, configPath),
    "--output-type",
    "json",
  ];

  if (knownViolationsPath) {
    args.push("--ignore-known", path.relative(cwd, knownViolationsPath));
  }

  args.push(target);

  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error(
      result.stderr.trim() ||
        `dependency-cruiser produced no JSON output for ${target}.`,
    );
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown JSON parse error";
    throw new Error(
      `dependency-cruiser returned invalid JSON for ${target}: ${message}`,
      { cause: error },
    );
  }
}

function buildCacheEntry({
  cwd,
  configPath,
  knownViolationsPath,
  target,
}) {
  const cruiseResult = runDependencyCruiser({
    cwd,
    configPath,
    knownViolationsPath,
    target,
  });
  const fileMtimes = new Map();

  for (const module of cruiseResult.modules ?? []) {
    fileMtimes.set(
      module.source,
      getFileMtimeMs(path.join(cwd, module.source)),
    );
  }

  return {
    configMtimeMs: getFileMtimeMs(configPath),
    configPath,
    cwd,
    fileMtimes,
    knownViolationsPath,
    modulesBySource: getModuleDependencyIndex(cruiseResult),
    ruleCommentsBySeverity: getRuleCommentIndex(cruiseResult),
    target,
  };
}

function isCacheEntryValid(entry, relativeFilename) {
  if (entry.configMtimeMs !== getFileMtimeMs(entry.configPath)) {
    return false;
  }

  const cachedFileMtime = entry.fileMtimes.get(relativeFilename);
  if (cachedFileMtime === undefined) {
    return false;
  }

  return (
    cachedFileMtime ===
    getFileMtimeMs(path.join(entry.cwd, relativeFilename))
  );
}

function getCruiseCacheEntry({
  cwd,
  configPath,
  knownViolationsPath,
  relativeFilename,
  target,
}) {
  const key = getCruiseCacheKey({
    cwd,
    configPath,
    knownViolationsPath,
    target,
  });
  const cachedEntry = cruiseCache.get(key);
  if (cachedEntry && isCacheEntryValid(cachedEntry, relativeFilename)) {
    return cachedEntry;
  }

  const nextEntry = buildCacheEntry({
    cwd,
    configPath,
    knownViolationsPath,
    target,
  });
  cruiseCache.set(key, nextEntry);
  return nextEntry;
}

function reportViolations(context, node, dependencyRules, ruleComments) {
  for (const rule of dependencyRules) {
    context.report({
      node,
      message: `${rule.name} (${node.source.value}): ${
        ruleComments.get(rule.name) ?? UNKNOWN_IMPORT_RULE_MESSAGE
      }`,
    });
  }
}

function createDependencyCruiserRule(severity) {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Report dependency-cruiser ${severity} violations`,
        recommended: true,
      },
      schema: [],
    },
    create(context) {
      let dependencyIndex = new Map();
      let initialized = false;
      let ruleComments = new Map();
      let setupError = null;

      function initialize(node) {
        if (initialized || setupError) {
          return;
        }

        try {
          initialized = true;
          const cwd = getContextCwd(context);
          const relativeFilename = getRelativeFilename(
            cwd,
            getPhysicalFilename(context),
          );

          if (!relativeFilename) {
            return;
          }

          const { configPath, knownViolationsPath } = normalizeSettings(
            context.settings?.["dependency-cruiser"],
            cwd,
          );
          const cacheEntry = getCruiseCacheEntry({
            cwd,
            configPath,
            knownViolationsPath,
            relativeFilename,
            target: getCruiseTarget(relativeFilename),
          });

          dependencyIndex =
            cacheEntry.modulesBySource.get(relativeFilename) ?? new Map();
          ruleComments =
            cacheEntry.ruleCommentsBySeverity.get(severity) ?? new Map();
        } catch (error) {
          setupError = error instanceof Error ? error : new Error(String(error));
          if (node) {
            context.report({
              node,
              message: `dependency-cruiser failed: ${setupError.message}`,
            });
          }
        }
      }

      function checkNode(node) {
        initialize();
        if (
          setupError ||
          !node.source ||
          typeof node.source.value !== "string"
        ) {
          return;
        }

        const dependencyRules =
          dependencyIndex
            .get(node.source.value)
            ?.filter((rule) => rule.severity === severity) ?? [];
        if (dependencyRules.length === 0) {
          return;
        }

        reportViolations(context, node, dependencyRules, ruleComments);
      }

      return {
        Program(node) {
          initialize(node);
        },
        ExportAllDeclaration: checkNode,
        ExportNamedDeclaration: checkNode,
        ImportDeclaration: checkNode,
      };
    },
  };
}

const dependencyCruiserPlugin = {
  rules: {
    errors: createDependencyCruiserRule("error"),
    warnings: createDependencyCruiserRule("warn"),
  },
  configs: {
    all: {
      plugins: ["dependency-cruiser"],
      rules: {
        "dependency-cruiser/errors": "error",
        "dependency-cruiser/warnings": "warn",
      },
    },
  },
};

export default dependencyCruiserPlugin;
