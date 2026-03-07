const MAX_DIFF_CHARS = 18000;

type ReviewPromptReason = "opened_once" | "on_push" | "manual_force";

export type ReviewPromptPullRequest = {
  number: number;
  title: string;
  body?: string;
  html_url: string;
  head: { sha: string };
  base: { sha: string };
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n...[truncated]`;
}

export function buildReviewSystemPrompt(params: {
  repo: string;
  prNumber: number;
  reason: ReviewPromptReason;
  basePolicyGuidance: string;
}): string {
  return [
    "You are the ReviewFlux PR review assistant.",
    "Write concise, actionable findings focused on correctness and maintainability.",
    "Your response is parsed by JSON.parse in production. Any non-JSON text causes a contract failure.",
    "Output must be exactly one JSON object with this shape:",
    '{"findings":[{"path":"string","line":123,"body":"string","severity":"Small|Medium|High"}]}',
    "Always include the `findings` key. If there are no actionable issues, return exactly {\"findings\":[]}.",
    "For anchored findings, `path` must be a changed file path from the diff and `line` must be a positive integer.",
    "For non-anchored findings, set path to \"\" and line to \"\".",
    "Each finding `body` must be markdown text with these sections in order: `🧠 ReviewFlux Review`, `### Summary`, `### Findings (ordered by severity)`, `### Verification Notes`.",
    "Do not output any text outside the single JSON object. Markdown is allowed only inside `body` string values.",
    "If project guidance (AGENTS.md/context) is provided, apply it while preserving this JSON contract.",
    ...(params.basePolicyGuidance
      ? [
          "Base review role/principles (from REVIEWFLUX-AGENTS.md):",
          params.basePolicyGuidance,
        ]
      : []),
    "Do not fabricate line numbers. Use exact changed-line numbers from the provided diff only.",
    "Do not output placeholder/meta text like [Pasted ...], ..., TBD, N/A, or <...>.",
    `Repository: ${params.repo}`,
    `Pull Request: #${params.prNumber}`,
    `Trigger reason: ${params.reason}`,
  ].join("\n");
}

export function buildReviewUserPrompt(params: {
  pr: ReviewPromptPullRequest;
  diff: string;
  globalAgentsGuidance: string;
  projectContext: string;
}): string {
  return [
    ...(params.globalAgentsGuidance
      ? [
          "User global guidance (~/.reviewflux/AGENTS.md):",
          params.globalAgentsGuidance,
          "",
        ]
      : []),
    ...(params.projectContext
      ? [
          "Registered project AGENTS/context markdown:",
          params.projectContext,
          "",
        ]
      : []),
    `PR title: ${params.pr.title}`,
    `PR URL: ${params.pr.html_url}`,
    "",
    "PR description:",
    params.pr.body?.trim() || "(empty)",
    "",
    "Unified diff:",
    truncate(params.diff, MAX_DIFF_CHARS),
    "",
    "Use the role/core principles from REVIEWFLUX-AGENTS.md provided in system prompt.",
    "Return one JSON object only. Do not return markdown or prose outside JSON.",
    "Output schema:",
    "{",
    '  "findings": [',
    '    { "path": "src/file.ts", "line": 128, "body": "🧠 ReviewFlux Review\\n\\n### Summary\\n<summary>\\n\\n### Findings (ordered by severity)\\n\\n- Severity: [High]\\n- Detail: ...\\n\\n### Verification Notes\\n- Verified: ...\\n- Not Verified: ...", "severity": "Small|Medium|High" },',
    '    { "path": "", "line": "", "body": "🧠 ReviewFlux Review\\n\\n### Summary\\n<summary>\\n\\n### Findings (ordered by severity)\\n\\n- Severity: [Medium]\\n- Detail: ...\\n\\n### Verification Notes\\n- Verified: ...\\n- Not Verified: ...", "severity": "Small|Medium|High" }',
    "  ]",
    "}",
    "Rules:",
    "- Sort findings by severity: High -> Medium -> Small.",
    "- For anchored findings, path must match a changed file in the diff and line must be an exact changed right-side line.",
    "- Never use fabricated/default line numbers.",
    "- If exact location is unclear, set path to \"\" and line to \"\".",
    "- Each finding body must include `🧠 ReviewFlux Review` + `### Summary` + `### Findings (ordered by severity)` + `### Verification Notes` in this order.",
    "- In `### Findings (ordered by severity)`, include `- Severity` and at least one concrete `- Detail` bullet.",
    "- If there are no actionable issues, return exactly {\"findings\":[]}.",
    "- Do not output placeholder/meta text such as [Pasted ...], ..., TBD, N/A, or <...>.",
    "- Do not wrap JSON in code fences.",
  ].join("\n");
}
