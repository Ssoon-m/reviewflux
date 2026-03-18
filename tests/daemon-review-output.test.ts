import { describe, expect, it } from "vitest";
import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
} from "../src/llm/review-prompt";
import { hasPostedReviewKey } from "../src/gateway/review-key";
import { resolveReviewOutputFromModel } from "../src/llm/review-output";

describe("daemon review output resolution", () => {
  it("treats valid empty findings JSON as no findings", () => {
    const result = resolveReviewOutputFromModel('{"findings":[]}');

    expect(result.findings).toEqual([]);
  });

  it("returns a fallback finding when the model output format is invalid", () => {
    const result = resolveReviewOutputFromModel(
      "🧠 ReviewFlux Review\n\n### Summary\nReview output format validation failed.",
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "", line: "" });
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
    expect(result.findings[0]?.body).not.toContain(
      "Best-effort rendering from model output text.",
    );
    expect(result.findings[0]?.body).not.toContain(
      "Review output format validation failed.",
    );
  });

  it("maps no-issue hints in malformed output to no findings", () => {
    const result = resolveReviewOutputFromModel("LGTM. No actionable issues found.");

    expect(result.findings).toEqual([]);
  });

  it("does not suppress invalid output that mixes LGTM with a real concern", () => {
    const result = resolveReviewOutputFromModel(
      "LGTM, but there is still a null guard issue in src/a.ts",
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
  });

  it("treats body-only JSON as invalid structured output", () => {
    const result = resolveReviewOutputFromModel(
      '{"body":"Potential null guard issue in changed path"}',
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
    expect(result.findings[0]).toMatchObject({ path: "", line: "" });
  });

  it("treats all-invalid findings arrays as invalid structured output", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":12,"body":"   "}]}',
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "", line: "" });
    expect(result.findings[0]?.body).toContain(
      "Review completed, but the model output format was invalid.",
    );
  });

  it("preserves line-anchored findings in canonical form", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"src/a.ts","line":12,"body":"- Detail: null guard missing around this branch","severity":"High"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: "- Detail: null guard missing around this branch",
      },
    ]);
  });

  it("preserves anchored finding body from model output", () => {
    const findingBody =
      "- Detail: possible null dereference in this branch";
    const result = resolveReviewOutputFromModel(
      JSON.stringify({
        findings: [
          {
            path: "src/a.ts",
            line: 12,
            body: findingBody,
            severity: "High",
          },
        ],
      }),
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.body).toBe(findingBody);
  });

  it("preserves strict review bodies without double-wrapping them", () => {
    const findingBody = [
      "🧠 ReviewFlux Review",
      "",
      "### Summary",
      "Already structured by model",
      "",
      "### Findings (ordered by severity)",
      "",
      "- Severity: [High]",
      "- Detail: Existing sectioned finding",
      "",
      "### Verification Notes",
      "- Verified: model-side check",
      "- Not Verified: runtime execution",
    ].join("\n");

    const result = resolveReviewOutputFromModel(
      JSON.stringify({
        findings: [
          {
            path: "src/a.ts",
            line: 12,
            body: findingBody,
            severity: "High",
          },
        ],
      }),
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.body).toBe(findingBody);
    expect((result.findings[0]?.body.match(/🧠 ReviewFlux Review/g) ?? []).length).toBe(1);
  });

  it("normalizes general findings without anchors", () => {
    const result = resolveReviewOutputFromModel(
      '{"findings":[{"path":"","line":"","body":"General finding without an anchor","severity":"Medium"}]}',
    );

    expect(result.findings).toEqual([
      {
        path: "",
        line: "",
        body: "General finding without an anchor",
      },
    ]);
  });

  it("keeps structured finding bodies for later posting-time rendering", () => {
    const structured = [
      "🧠 ReviewFlux Review",
      "",
      "### Summary",
      "Digest target summary",
      "",
      "### Findings (ordered by severity)",
      "",
      "- Severity: [Medium]",
      "- Detail: something",
      "",
      "### Verification Notes",
      "- Verified: parser",
      "- Not Verified: runtime",
    ].join("\n");

    const result = resolveReviewOutputFromModel(
      JSON.stringify({
        findings: [
          {
            path: "",
            line: "",
            body: structured,
            severity: "Medium",
          },
        ],
      }),
    );

    expect(result.findings).toEqual([
      {
        path: "",
        line: "",
        body: structured,
      },
    ]);
  });
});

describe("posted review key guard", () => {
  it("matches exact pr/head/reason tuple", () => {
    const postedReviewKeys = ["42:abc123:on_push"];

    expect(
      hasPostedReviewKey({
        postedReviewKeys,
        prNumber: 42,
        prHeadSha: "abc123",
        reason: "on_push",
      }),
    ).toBe(true);
    expect(
      hasPostedReviewKey({
        postedReviewKeys,
        prNumber: 42,
        prHeadSha: "abc123",
        reason: "manual_force",
      }),
    ).toBe(false);
    expect(
      hasPostedReviewKey({
        postedReviewKeys,
        prNumber: 42,
        prHeadSha: "def456",
        reason: "on_push",
      }),
    ).toBe(false);
  });
});

describe("review prompt contracts", () => {
  it("system prompt enforces strict single-object JSON findings contract", () => {
    const prompt = buildReviewSystemPrompt({
      repo: "ssoon-m/reviewflux",
      prNumber: 12,
      reason: "on_push",
      basePolicyGuidance: "- Keep findings specific",
    });

    expect(prompt).toContain(
      "Your response is parsed by JSON.parse in production. Any non-JSON text causes a contract failure.",
    );
    expect(prompt).toContain(
      '{"findings":[{"path":"string","line":123,"body":"string","severity":"Small|Medium|High"}]}',
    );
    expect(prompt).toContain(
      "Always include the `findings` key. If there are no actionable issues, return exactly {\"findings\":[]}.",
    );
    expect(prompt).toContain(
      "Each finding `body` must be markdown text with these sections in order: `### Summary`, `### Findings (ordered by severity)`, `### Verification Notes`.",
    );
    expect(prompt).toContain(
      "Do not output any text outside the single JSON object. Markdown is allowed only inside `body` string values.",
    );
  });

  it("user prompt requires JSON findings and explicit non-anchor fallback", () => {
    const prompt = buildReviewUserPrompt({
      pr: {
        number: 45,
        title: "Improve queue behavior",
        body: "tighten retries and review behavior",
        html_url: "https://github.com/ssoon-m/reviewflux/pull/45",
        head: { sha: "abc123" },
        base: { sha: "def456" },
      },
      diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-console.log('a')\n+console.log('b')\n",
      globalAgentsGuidance: "Global guidance text",
      projectContext: "# Context File: AGENTS.md\n\nUse project conventions.",
    });

    expect(prompt).toContain("Return one JSON object only. Do not return markdown or prose outside JSON.");
    expect(prompt).toContain("- If exact location is unclear, set path to \"\" and line to \"\".");
    expect(prompt).toContain(
      "- Each finding body must include `### Summary` + `### Findings (ordered by severity)` + `### Verification Notes` in this order.",
    );
    expect(prompt).toContain(
      "- In `### Findings (ordered by severity)`, include `- Severity` and at least one concrete `- Detail` bullet.",
    );
    expect(prompt).toContain("- If there are no actionable issues, return exactly {\"findings\":[]}.");
    expect(prompt).not.toContain("The first line must match this exact string");
  });
});
