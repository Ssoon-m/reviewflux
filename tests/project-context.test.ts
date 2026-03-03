import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProjectContextText } from "../src/llm/project-context.js";

describe("project context", () => {
  it("uses AGENTS.md by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "reviewflux-project-context-"));
    writeFileSync(join(dir, "AGENTS.md"), "# rules\nAlways be precise.");
    writeFileSync(join(dir, "README.md"), "ignore me");

    const text = buildProjectContextText({ workspaceDir: dir, context: { mode: "default" } });
    expect(text).toContain("Context File: AGENTS.md");
    expect(text).toContain("Always be precise");
    expect(text).not.toContain("README.md");
  });

  it("uses custom markdown patterns", () => {
    const dir = mkdtempSync(join(tmpdir(), "reviewflux-project-context-"));
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "review.md"), "custom review rules");
    writeFileSync(join(dir, "AGENTS.md"), "default rules");

    const text = buildProjectContextText({
      workspaceDir: dir,
      context: { mode: "custom", include: ["docs/*.md"] },
    });

    expect(text).toContain("Context File: docs/review.md");
    expect(text).toContain("custom review rules");
    expect(text).not.toContain("AGENTS.md");
  });
});
