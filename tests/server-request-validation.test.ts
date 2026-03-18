import { describe, expect, it } from "vitest";
import {
  getClientErrorCode,
  parsePromptText,
} from "../src/gateway/http-server";
import { parseModelAliasesJson } from "../src/llm/service";

describe("http server utilities", () => {
  it("accepts non-empty strings", () => {
    expect(parsePromptText(" hello ")).toBe("hello");
  });

  it("rejects empty or non-string prompts", () => {
    expect(parsePromptText("   ")).toBeNull();
    expect(parsePromptText({ q: "hi" })).toBeNull();
    expect(parsePromptText(123)).toBeNull();
    expect(parsePromptText(undefined)).toBeNull();
  });

  it("maps server-side failures to a stable client error", () => {
    expect(
      getClientErrorCode(
        new Error("llm_request_failed (500): sensitive details"),
      ),
    ).toBe("internal_error");
    expect(getClientErrorCode("anything")).toBe("internal_error");
  });

  it("parses model aliases JSON with lowercase keys", () => {
    const aliases = parseModelAliasesJson(
      '{"FAST":{"provider":"google","model":"gemini-2.5-flash"}}',
    );

    expect(aliases.fast).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
    });
  });
});
