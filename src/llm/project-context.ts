export type ProjectContextConfig = {
  mode: "default" | "custom";
  include?: string[];
};

export type ContextFile = {
  path: string;
  content: string;
};

const DEFAULT_CONTEXT_PATTERNS = ["AGENTS.md"];
const MAX_CONTEXT_FILES = 5;
const MAX_FILE_CHARS = 4000;
const MAX_TOTAL_CHARS = 12000;

function normalizePathForMatch(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "__GLOBSTAR__")
    .replaceAll("*", "[^/]*")
    .replaceAll("__GLOBSTAR__", ".*");
  return new RegExp(`^${escaped}$`);
}

export function resolveContextPatterns(config?: ProjectContextConfig): string[] {
  if (!config || config.mode === "default") return DEFAULT_CONTEXT_PATTERNS;
  const includes = (config.include ?? []).map((v) => v.trim()).filter(Boolean);
  return includes.length > 0 ? includes : DEFAULT_CONTEXT_PATTERNS;
}

export function pickContextFilePaths(params: { filePaths: string[]; patterns: string[] }): string[] {
  const regexes = params.patterns.map(globToRegex);

  return params.filePaths
    .filter((filePath) => {
      const relPath = normalizePathForMatch(filePath);
      return relPath.toLowerCase().endsWith(".md") && regexes.some((regex) => regex.test(relPath));
    })
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_CONTEXT_FILES);
}

export function buildProjectContextText(params: {
  context?: ProjectContextConfig;
  files: ContextFile[];
}): string {
  const patterns = resolveContextPatterns(params.context);
  const selectedPaths = new Set(pickContextFilePaths({ filePaths: params.files.map((file) => normalizePathForMatch(file.path)), patterns }));
  const matched = params.files
    .filter((file) => selectedPaths.has(normalizePathForMatch(file.path)))
    .sort((a, b) => a.path.localeCompare(b.path));

  const contextFiles: ContextFile[] = [];
  let totalChars = 0;

  for (const file of matched) {
    const content = file.content.slice(0, MAX_FILE_CHARS);
    if (totalChars + content.length > MAX_TOTAL_CHARS) break;
    totalChars += content.length;
    contextFiles.push({ path: normalizePathForMatch(file.path), content });
  }

  if (contextFiles.length === 0) return "";

  return contextFiles
    .map((file) => `# Context File: ${file.path}\n\n${file.content}`)
    .join("\n\n---\n\n");
}
