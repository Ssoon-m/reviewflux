import { describe, expect, it } from "vitest";
import { buildProjectContextText } from "../src/llm/project-context.js";

describe("project context", () => {
  it("uses AGENTS.md by default", () => {
    const text = buildProjectContextText({
      context: { mode: "default" },
      files: [
        { path: "AGENTS.md", content: "# rules\nAlways be precise." },
        { path: "README.md", content: "ignore me" },
      ],
    });

    expect(text).toContain("Context File: AGENTS.md");
    expect(text).toContain("Always be precise");
    expect(text).not.toContain("README.md");
  });

  it("uses custom markdown patterns", () => {
    const text = buildProjectContextText({
      context: { mode: "custom", include: ["docs/*.md"] },
      files: [
        { path: "docs/review.md", content: "custom review rules" },
        { path: "AGENTS.md", content: "default rules" },
      ],
    });

    expect(text).toContain("Context File: docs/review.md");
    expect(text).toContain("custom review rules");
    expect(text).not.toContain("AGENTS.md");
  });
});
