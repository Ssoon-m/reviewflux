import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config/env.js";

describe("readConfig model defaults", () => {
  it("defaults model based on provider", () => {
    const google = readConfig({
      LLM_PROVIDER: "google",
      LLM_AUTH_MODE: "apikey",
      LLM_API_KEY: "x",
      LLM_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      PORT: "3000",
    });
    expect(google.LLM_MODEL).toBe("gemini-2.5-flash");

    const openai = readConfig({
      LLM_PROVIDER: "openai",
      LLM_AUTH_MODE: "apikey",
      LLM_API_KEY: "x",
      LLM_API_BASE_URL: "https://api.openai.com/v1",
      PORT: "3000",
    });
    expect(openai.LLM_MODEL).toBe("gpt-4o-mini");
  });
});
