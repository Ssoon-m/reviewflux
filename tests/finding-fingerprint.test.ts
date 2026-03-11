import { describe, expect, it } from "vitest";
import { createFindingFingerprint } from "../src/review/finding-fingerprint.js";

describe("finding fingerprint", () => {
  it("matches identical findings regardless of title wrapper", () => {
    const inlineBody = [
      "🧠 ReviewFlux Review",
      "",
      "### Summary",
      "src/config/project-input.ts imports normalizeRepoKey from src/llm/model-routing.ts.",
      "",
      "### Findings (ordered by severity)",
      "",
      "- Severity: [Medium]",
      "- Detail: src/config should not depend on llm-specific modules.",
      "",
      "### Verification Notes",
      "- Verified: import path inspection",
      "- Not Verified: runtime execution",
    ].join("\n");

    const summaryOnlyBody = [
      "### Summary",
      "src/config/project-input.ts imports normalizeRepoKey from src/llm/model-routing.ts.",
      "",
      "### Findings (ordered by severity)",
      "",
      "- Severity: [Medium]",
      "- Detail: src/config should not depend on llm-specific modules.",
      "",
      "### Verification Notes",
      "- Verified: import path inspection",
      "- Not Verified: runtime execution",
    ].join("\n");

    expect(createFindingFingerprint(inlineBody)).toBe(
      createFindingFingerprint(summaryOnlyBody),
    );
  });

  it("uses summary and detail bullets as the dedupe key", () => {
    const body = [
      "🧠 ReviewFlux Review",
      "",
      "### Summary",
      "First issue",
      "",
      "### Findings (ordered by severity)",
      "",
      "- Severity: [High]",
      "- Detail: first detail",
      "- Detail: second detail",
      "",
      "### Verification Notes",
      "- Verified: one",
      "- Not Verified: two",
    ].join("\n");

    expect(createFindingFingerprint(body)).toBe(
      "first issue|- detail: first detail|- detail: second detail",
    );
  });
});
