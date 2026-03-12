import { describe, expect, it } from "vitest";
import {
  normalizeRepoInput,
  parsePrReviewMode,
} from "../src/project/input.js";

describe("project shared", () => {
  it("normalizes owner/repo from URL or plain input", () => {
    expect(normalizeRepoInput("https://github.com/Ssoon-m/reviewflux")).toBe(
      "ssoon-m/reviewflux",
    );
    expect(normalizeRepoInput("https://GitHub.com/Ssoon-m/reviewflux")).toBe(
      "ssoon-m/reviewflux",
    );
    expect(normalizeRepoInput("https://www.github.com/Ssoon-m/reviewflux")).toBe(
      "ssoon-m/reviewflux",
    );
    expect(normalizeRepoInput("github.com/Ssoon-m/reviewflux")).toBe(
      "ssoon-m/reviewflux",
    );
    expect(normalizeRepoInput("Ssoon-m/reviewflux")).toBe("ssoon-m/reviewflux");
  });

  it("parses valid pr review modes", () => {
    expect(parsePrReviewMode("opened_once")).toBe("opened_once");
    expect(parsePrReviewMode("on_push")).toBe("on_push");
  });

  it("rejects invalid repo/mode", () => {
    expect(() => normalizeRepoInput("reviewflux-only")).toThrow(
      "repo_format_invalid",
    );
    expect(() => parsePrReviewMode("opened" as never)).toThrow(
      "invalid_pr_review_mode:opened",
    );
  });

});
