import { describe, expect, it } from "vitest";
import { parsePromptText } from "../src/server.js";

describe("parsePromptText", () => {
  it("accepts non-empty strings", () => {
    expect(parsePromptText(" hello ")).toBe("hello");
  });

  it("rejects empty strings", () => {
    expect(parsePromptText("   ")).toBeNull();
  });

  it("rejects non-string payloads", () => {
    expect(parsePromptText({ q: "hi" })).toBeNull();
    expect(parsePromptText(123)).toBeNull();
    expect(parsePromptText(undefined)).toBeNull();
  });
});
