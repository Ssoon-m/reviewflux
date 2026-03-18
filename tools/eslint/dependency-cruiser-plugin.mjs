import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import assertRuleSetValid from "../../node_modules/dependency-cruiser/src/main/rule-set/assert-validity.mjs";
import normalizeRuleSet from "../../node_modules/dependency-cruiser/src/main/rule-set/normalize.mjs";
import { validateDependency } from "../../node_modules/dependency-cruiser/src/validate/index.mjs";

const require = createRequire(import.meta.url);
const DEFAULT_CONFIG_FILE = ".dependency-cruiser.cjs";
const UNKNOWN_IMPORT_RULE_MESSAGE = "Import violates a dependency-cruiser rule.";
const runtimeCache = new Map();

const FORMAT_DIAGNOSTICS_HOST = {
  getCanonicalFileName(fileName) {
    return ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
  },
  getCurrentDirectory() {
    return process.cwd();
  },
  getNewLine() {
    return "\n";
  },
};

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

  return {
    configPath: path.resolve(
      cwd,
      typeof settings.config === "string" ? settings.config : DEFAULT_CONFIG_FILE,
    ),
  };
}

function resolveTsConfigPath(cwd, ruleSet) {
  const configuredFileName = ruleSet.options?.tsConfig?.fileName ?? "tsconfig.json";
  const tsConfigPath = path.resolve(cwd, configuredFileName);
  return getFileMtimeMs(tsConfigPath) === null ? null : tsConfigPath;
}

function loadCompilerOptions(tsConfigPath) {
  if (!tsConfigPath) {
    return {
      compilerOptions: {},
      tsConfigMtimeMs: null,
    };
  }

  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      ts.formatDiagnostics([configFile.error], FORMAT_DIAGNOSTICS_HOST),
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsConfigPath),
    {},
    tsConfigPath,
  );
  if (parsedConfig.errors.length > 0) {
    throw new Error(
      ts.formatDiagnostics(parsedConfig.errors, FORMAT_DIAGNOSTICS_HOST),
    );
  }

  return {
    compilerOptions: parsedConfig.options,
    tsConfigMtimeMs: getFileMtimeMs(tsConfigPath),
  };
}

function getRuleCommentsBySeverity(ruleSet) {
  const commentsBySeverity = new Map();

  for (const rule of ruleSet.forbidden ?? []) {
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

function loadDependencyCruiserRuntime(cwd, configPath) {
  const configMtimeMs = getFileMtimeMs(configPath);
  const cachedRuntime = runtimeCache.get(configPath);

  if (
    cachedRuntime &&
    cachedRuntime.configMtimeMs === configMtimeMs &&
    cachedRuntime.tsConfigMtimeMs ===
      getFileMtimeMs(cachedRuntime.tsConfigPath)
  ) {
    return cachedRuntime;
  }

  const resolvedConfigPath = require.resolve(configPath);
  delete require.cache[resolvedConfigPath];

  const rawConfigModule = require(resolvedConfigPath);
  const rawRuleSet = rawConfigModule?.default ?? rawConfigModule;
  assertRuleSetValid(rawRuleSet);

  const ruleSet = normalizeRuleSet(rawRuleSet);
  const tsConfigPath = resolveTsConfigPath(cwd, ruleSet);
  const { compilerOptions, tsConfigMtimeMs } = loadCompilerOptions(tsConfigPath);

  const runtime = {
    compilerOptions,
    configMtimeMs,
    ruleCommentsBySeverity: getRuleCommentsBySeverity(ruleSet),
    ruleSet,
    tsConfigMtimeMs,
    tsConfigPath,
  };
  runtimeCache.set(configPath, runtime);
  return runtime;
}

function getImportProtocol(specifier) {
  const protocolMatch = specifier.match(/^[a-zA-Z][\w+.-]*:/);
  return protocolMatch?.[0] ?? "";
}

function buildDependencyDescriptor({
  specifier,
  resolvedPath,
  couldNotResolve,
  isCoreModule,
  isExternalLibraryImport,
}) {
  let dependencyTypes;
  if (isCoreModule) {
    dependencyTypes = ["core", "import"];
  } else if (isExternalLibraryImport) {
    dependencyTypes = ["npm", "import"];
  } else if (couldNotResolve) {
    dependencyTypes = ["unknown", "import"];
  } else {
    dependencyTypes = ["local", "import"];
  }

  return {
    circular: false,
    coreModule: isCoreModule,
    couldNotResolve,
    dependencyTypes,
    dynamic: false,
    exoticallyRequired: false,
    followable: !isCoreModule && !couldNotResolve,
    instability: 0,
    mimeType: "",
    module: specifier,
    moduleSystem: "es6",
    protocol: getImportProtocol(specifier),
    resolved: resolvedPath,
    valid: true,
  };
}

function resolveImportSpecifier({
  specifier,
  absoluteFilename,
  compilerOptions,
  cwd,
}) {
  if (specifier.startsWith("node:")) {
    return buildDependencyDescriptor({
      specifier,
      resolvedPath: specifier,
      couldNotResolve: false,
      isCoreModule: true,
      isExternalLibraryImport: false,
    });
  }

  const resolution = ts.resolveModuleName(
    specifier,
    absoluteFilename,
    compilerOptions,
    ts.sys,
  ).resolvedModule;

  if (resolution?.resolvedFileName) {
    const isExternalLibraryImport =
      resolution.isExternalLibraryImport ||
      resolution.resolvedFileName.includes(`${path.sep}node_modules${path.sep}`);
    const relativeResolvedPath = getRelativeFilename(
      cwd,
      resolution.resolvedFileName,
    );

    return buildDependencyDescriptor({
      specifier,
      resolvedPath:
        relativeResolvedPath ?? toPosixPath(resolution.resolvedFileName),
      couldNotResolve: false,
      isCoreModule: false,
      isExternalLibraryImport,
    });
  }

  return buildDependencyDescriptor({
    specifier,
    resolvedPath: specifier,
    couldNotResolve: true,
    isCoreModule: false,
    isExternalLibraryImport: false,
  });
}

function reportViolations(context, node, violations, ruleComments) {
  for (const violation of violations) {
    context.report({
      node,
      message: `${violation.name} (${node.source.value}): ${
        ruleComments.get(violation.name) ?? UNKNOWN_IMPORT_RULE_MESSAGE
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
      let absoluteFilename = null;
      let initialized = false;
      let relativeFilename = null;
      let resolutionCache = new Map();
      let ruleComments = new Map();
      let runtime = null;
      let setupError = null;

      function initialize(node) {
        if (initialized || setupError) {
          return;
        }

        try {
          initialized = true;
          const cwd = getContextCwd(context);
          absoluteFilename = getPhysicalFilename(context);
          relativeFilename = getRelativeFilename(cwd, absoluteFilename);

          if (!relativeFilename || !absoluteFilename) {
            return;
          }

          const { configPath } = normalizeSettings(
            context.settings?.["dependency-cruiser"],
            cwd,
          );
          runtime = loadDependencyCruiserRuntime(cwd, configPath);
          ruleComments =
            runtime.ruleCommentsBySeverity.get(severity) ?? new Map();
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
        initialize(node);
        if (
          setupError ||
          !runtime ||
          !absoluteFilename ||
          !relativeFilename ||
          !node.source ||
          typeof node.source.value !== "string"
        ) {
          return;
        }

        const specifier = node.source.value;
        const dependency =
          resolutionCache.get(specifier) ??
          resolveImportSpecifier({
            specifier,
            absoluteFilename,
            compilerOptions: runtime.compilerOptions,
            cwd: getContextCwd(context),
          });
        resolutionCache.set(specifier, dependency);

        const validation = validateDependency(
          runtime.ruleSet,
          { source: relativeFilename, instability: 0 },
          dependency,
        );
        const violations =
          validation.rules?.filter((rule) => rule.severity === severity) ?? [];

        if (violations.length > 0) {
          reportViolations(context, node, violations, ruleComments);
        }
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
