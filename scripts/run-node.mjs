#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const distEntry = path.join(cwd, "dist", "cli", "index.mjs");
const srcRoot = path.join(cwd, "src");
const watchFiles = [path.join(cwd, "package.json"), path.join(cwd, "tsconfig.json")];

function statMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function latestMtimeInDir(dirPath) {
  let latest = null;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const mtime = statMtime(fullPath);
      if (mtime == null) continue;
      if (latest == null || mtime > latest) latest = mtime;
    }
  }
  return latest;
}

function shouldBuild() {
  const distMtime = statMtime(distEntry);
  if (distMtime == null) return true;

  const srcMtime = latestMtimeInDir(srcRoot);
  if (srcMtime != null && srcMtime > distMtime) return true;

  for (const filePath of watchFiles) {
    const mtime = statMtime(filePath);
    if (mtime != null && mtime > distMtime) return true;
  }

  return false;
}

function run(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function buildIfNeeded() {
  if (!shouldBuild()) return 0;

  process.stderr.write("[reviewflux] Building TypeScript (dist is stale).\n");
  const isWindows = process.platform === "win32";
  const command = isWindows ? "cmd.exe" : "pnpm";
  const commandArgs = isWindows ? ["/d", "/s", "/c", "pnpm", "build"] : ["build"];
  const res = await run(command, commandArgs);
  if (res.signal) return 1;
  return res.code ?? 1;
}

async function main() {
  const buildCode = await buildIfNeeded();
  if (buildCode !== 0) {
    process.exit(buildCode);
  }

  if (statMtime(distEntry) == null) {
    process.stderr.write("[reviewflux] dist entry is missing after build.\n");
    process.exit(1);
  }

  const res = await run(process.execPath, [distEntry, ...args]);
  if (res.signal) {
    process.exit(1);
  }
  process.exit(res.code ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
