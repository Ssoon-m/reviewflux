import { describe, expect, it } from "vitest";
import { getCodexEffortLevels, resolveCodexEffort } from "../src/llm/reasoning-effort";

describe("codex reasoning effort support", () => {
  it("does not expose xhigh for gpt-5.1-codex-mini", () => {
    const levels = getCodexEffortLevels({ authMode: "oauth", model: "gpt-5.1-codex-mini" });
    expect(levels).toEqual(["low", "medium", "high"]);
  });

  it("exposes xhigh for gpt-5.3-codex", () => {
    const levels = getCodexEffortLevels({ authMode: "oauth", model: "gpt-5.3-codex" });
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("downgrades unsupported requested effort", () => {
    const resolved = resolveCodexEffort({
      authMode: "oauth",
      model: "gpt-5.1-codex-mini",
      requested: "xhigh",
    });

    expect(resolved).toBe("high");
  });
});
