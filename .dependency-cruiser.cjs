/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-gateway-to-review-runtime",
      comment:
        "Gateway publishes decided review output and must not import review-runtime behavior.",
      severity: "error",
      from: { path: "^src/gateway/" },
      to: { path: "^src/review(?:/|$)" },
    },
    {
      name: "no-cross-cutting-to-domains",
      comment:
        "Files under src/contracts, src/config, src/infra/logging, src/lib, and src/types must not import higher-level domain behavior.",
      severity: "error",
      from: {
        path: "^src/(contracts|config|infra/logging|lib|types)(?:/|$)",
      },
      to: {
        path: "^src/(auth|commands|gateway|llm|review)(?:/|$)",
      },
    },
    {
      name: "no-auth-to-shell-runtime-or-publishing",
      comment:
        "Auth should stay provider-focused and must not depend on shell, review runtime, or publishing layers.",
      severity: "error",
      from: { path: "^src/auth/" },
      to: {
        path: "^src/(commands|gateway|review)(?:/|$)",
      },
    },
    {
      name: "no-llm-to-shell-or-review-runtime",
      comment:
        "LLM provider plumbing must not own shell orchestration or review-runtime behavior.",
      severity: "error",
      from: { path: "^src/llm/" },
      to: {
        path: "^src/(commands|review)(?:/|$)",
      },
    },
    {
      name: "no-queue-to-shell-or-publishing",
      comment:
        "Queue processing should not depend on shell entrypoints or publishing boundaries.",
      severity: "error",
      from: { path: "^src/review/queue/" },
      to: {
        path: "^src/(cli|commands|gateway)(?:/|$)",
      },
    },
  ],
  options: {
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
  },
};
