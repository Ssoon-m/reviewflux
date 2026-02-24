import { describe, expect, it } from "vitest";
import { getClientErrorCode, parsePromptText } from "../src/server.js";

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

  it("maps server-side failures to stable client error code", () => {
    expect(getClientErrorCode(new Error("llm_request_failed (500): sensitive details"))).toBe("internal_error");
    expect(getClientErrorCode("anything")).toBe("internal_error");
  });
});
