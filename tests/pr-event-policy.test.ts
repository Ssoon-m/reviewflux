import { describe, expect, it } from "vitest";
import type { ReviewFluxConfig } from "../src/cli/config.js";
import { decidePrReview } from "../src/gateway/pr-event-policy.js";

const baseConfig: ReviewFluxConfig = {
  appName: "reviewflux",
  llm: "openai-codex",
  authMode: "apikey",
  llmApiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-5-codex",
  projects: {
    "ssoon-m/reviewflux": {
      repo: "ssoon-m/reviewflux",
      workspaceDir: "/tmp/reviewflux",
      pr: {
        mode: "opened_once",
        forceCommand: "@reviewflux",
      },
      context: { mode: "default" },
    },
  },
};

describe("pr event policy", () => {
  it("reviews once on opened when mode is opened_once", () => {
    const opened = decidePrReview(baseConfig, {
      eventName: "pull_request",
      repo: "Ssoon-m/reviewflux",
      action: "opened",
    });
    const sync = decidePrReview(baseConfig, {
      eventName: "pull_request",
      repo: "ssoon-m/reviewflux",
      action: "synchronize",
    });

    expect(opened.shouldReview).toBe(true);
    expect(opened.reason).toBe("opened_once");
    expect(sync.shouldReview).toBe(false);
  });

  it("reviews on synchronize when mode is on_push", () => {
    const config: ReviewFluxConfig = {
      ...baseConfig,
      projects: {
        "ssoon-m/reviewflux": {
          repo: "ssoon-m/reviewflux",
          workspaceDir: "/tmp/reviewflux",
          pr: {
            mode: "on_push",
            forceCommand: "@reviewflux",
          },
          context: { mode: "default" },
        },
      },
    };

    const result = decidePrReview(config, {
      eventName: "pull_request",
      repo: "ssoon-m/reviewflux",
      action: "synchronize",
    });

    expect(result.shouldReview).toBe(true);
    expect(result.reason).toBe("on_push");
  });

  it("forces review when @reviewflux is mentioned in comment", () => {
    const result = decidePrReview(baseConfig, {
      eventName: "issue_comment",
      repo: "ssoon-m/reviewflux",
      commentBody: "@reviewflux please run now",
    });

    expect(result.shouldReview).toBe(true);
    expect(result.force).toBe(true);
    expect(result.reason).toBe("manual_force");
  });
});
