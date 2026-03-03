import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type ProjectContextConfig = {
  mode: "default" | "custom";
  include?: string[];
};

type ContextFile = {
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

function listWorkspaceMarkdownFiles(workspaceDir: string): string[] {
  const results: string[] = [];

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      results.push(fullPath);
    }
  };

  if (existsSync(workspaceDir) && statSync(workspaceDir).isDirectory()) {
    walk(workspaceDir);
  }

  return results;
}

function resolvePatterns(config?: ProjectContextConfig): string[] {
  if (!config || config.mode === "default") return DEFAULT_CONTEXT_PATTERNS;
  const includes = (config.include ?? []).map((v) => v.trim()).filter(Boolean);
  return includes.length > 0 ? includes : DEFAULT_CONTEXT_PATTERNS;
}

function pickContextFiles(params: { workspaceDir: string; patterns: string[] }): ContextFile[] {
  const files = listWorkspaceMarkdownFiles(params.workspaceDir);
  const regexes = params.patterns.map(globToRegex);

  const matched = files
    .filter((filePath) => {
      const rel = normalizePathForMatch(relative(params.workspaceDir, filePath));
      return regexes.some((regex) => regex.test(rel));
    })
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_CONTEXT_FILES);

  const contextFiles: ContextFile[] = [];
  let totalChars = 0;

  for (const filePath of matched) {
    const rel = normalizePathForMatch(relative(params.workspaceDir, filePath));
    const raw = readFileSync(filePath, "utf8");
    const content = raw.slice(0, MAX_FILE_CHARS);
    if (totalChars + content.length > MAX_TOTAL_CHARS) break;
    totalChars += content.length;
    contextFiles.push({ path: rel, content });
  }

  return contextFiles;
}

export function buildProjectContextText(params: {
  workspaceDir: string;
  context?: ProjectContextConfig;
}): string {
  const patterns = resolvePatterns(params.context);
  const files = pickContextFiles({ workspaceDir: params.workspaceDir, patterns });
  if (files.length === 0) return "";

  return files
    .map((file) => `# Context File: ${file.path}\n\n${file.content}`)
    .join("\n\n---\n\n");
}
