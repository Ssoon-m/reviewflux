import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { isDirectRun } from "../src/gateway/http-server";

describe("isDirectRun", () => {
  it("matches when argv1 points to a symlink of the real entry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-flow-ai-"));
    const realFile = join(dir, "server.real.js");
    const linkFile = join(dir, "server.link.js");

    writeFileSync(realFile, "// test");
    symlinkSync(realFile, linkFile);

    expect(isDirectRun(`file://${realFile}`, linkFile)).toBe(true);
  });

  it("returns false when argv1 is missing", () => {
    expect(isDirectRun("file:///tmp/app/server.js", undefined)).toBe(false);
  });
});
