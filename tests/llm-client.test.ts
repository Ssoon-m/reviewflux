import { describe, expect, it, vi } from "vitest";
import { OAuthTokenProvider } from "../src/auth/oauth-token-provider.js";
import {
  GeminiLlmClient,
  OAuthLlmClient,
  OpenAIApiKeyLlmClient,
  createLlmProvider,
  resolveModelRef,
} from "../src/llm/client.js";

describe("OAuthLlmClient", () => {
  it("uses bearer token and returns content", async () => {
    const tokenFetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "token-123", expires_in: 3600 }), { status: 200 }),
    );

    const llmFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer token-123" });
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
    });

    const tokenProvider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret",
      },
      tokenFetch as unknown as typeof fetch,
    );

    const client = new OAuthLlmClient(
      {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.3-codex",
        tokenProvider,
      },
      llmFetch as unknown as typeof fetch,
    );

    await expect(client.generateReply([{ role: "user", content: "hi" }])).resolves.toBe("hello");
  });
});

describe("OpenAIApiKeyLlmClient", () => {
  it("uses api key bearer auth", async () => {
    const llmFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer key-123" });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });

    const client = new OpenAIApiKeyLlmClient(
      {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "key-123",
      },
      llmFetch as unknown as typeof fetch,
    );

    await expect(client.generateReply([{ role: "user", content: "hi" }])).resolves.toBe("ok");
  });
});

describe("GeminiLlmClient", () => {
  it("calls native generateContent endpoint", async () => {
    const llmFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/models/gemini-2.5-flash:generateContent?key=gem-key");
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ role: string; parts: Array<{ text: string }> }> };
      expect(body.contents[0].parts[0].text).toContain("[SYSTEM]");
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini-ok" }] } }] }),
        { status: 200 },
      );
    });

    const client = new GeminiLlmClient(
      {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-flash",
        apiKey: "gem-key",
      },
      llmFetch as unknown as typeof fetch,
    );

    await expect(
      client.generateReply([
        { role: "system", content: "be concise" },
        { role: "user", content: "hi" },
      ]),
    ).resolves.toBe("gemini-ok");
  });
});

describe("createLlmProvider", () => {
  it("creates oauth provider implementation", () => {
    const tokenProvider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret",
      },
      vi.fn(async () => new Response(JSON.stringify({ access_token: "x", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    );

    const provider = createLlmProvider({
      authMode: "oauth",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.3-codex",
      tokenProvider,
    });

    expect(provider).toBeInstanceOf(OAuthLlmClient);
  });

  it("creates gemini provider implementation", () => {
    const provider = createLlmProvider({
      authMode: "apikey",
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      apiKey: "key-123",
    });

    expect(provider).toBeInstanceOf(GeminiLlmClient);
  });
});

describe("resolveModelRef", () => {
  it("resolves provider/model refs and aliases", () => {
    expect(resolveModelRef({ raw: "gemini/gemini-2.5-flash", defaultProvider: "openai" })).toEqual({
      provider: "gemini",
      model: "gemini-2.5-flash",
    });

    expect(
      resolveModelRef({
        raw: "fast",
        defaultProvider: "openai",
        aliases: { fast: { provider: "gemini", model: "gemini-2.5-flash" } },
      }),
    ).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
  });
});
