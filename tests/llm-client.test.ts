import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeSimpleMock, getModelMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
  getModelMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    completeSimple: completeSimpleMock,
    getModel: getModelMock,
  };
});

import { OAuthTokenProvider } from "../src/auth/oauth-token-provider.js";
import {
  GeminiLlmClient,
  OAuthLlmClient,
  OpenAIApiKeyLlmClient,
  createLlmProvider,
  resolveModelRef,
} from "../src/llm/client.js";

beforeEach(() => {
  completeSimpleMock.mockReset();
  getModelMock.mockReset();
});

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
  it("uses pi-ai completeSimple with api key", async () => {
    getModelMock.mockReturnValueOnce({
      id: "gemini-2.5-flash",
      name: "Gemini",
      api: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1,
      maxTokens: 1,
    });
    completeSimpleMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "gemini-ok" }],
    });

    const client = new GeminiLlmClient({
      authMode: "apikey",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      apiKey: "gem-key",
    });

    await expect(
      client.generateReply([
        { role: "system", content: "be concise" },
        { role: "user", content: "hi" },
      ]),
    ).resolves.toBe("gemini-ok");

    expect(completeSimpleMock).toHaveBeenCalled();
    const [, , options] = completeSimpleMock.mock.calls[0];
    expect(options).toMatchObject({ apiKey: "gem-key" });
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

  it("creates gemini oauth provider implementation", async () => {
    getModelMock.mockReturnValueOnce({
      id: "gemini-2.5-pro",
      name: "Gemini",
      api: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1,
      maxTokens: 1,
    });
    completeSimpleMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tokenProvider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret",
      },
      vi.fn(async () => new Response(JSON.stringify({ access_token: "gem-oauth", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    );

    const provider = createLlmProvider({
      authMode: "oauth",
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-pro",
      tokenProvider,
    });

    expect(provider).toBeInstanceOf(GeminiLlmClient);
    await expect(provider.generateReply([{ role: "user", content: "hi" }])).resolves.toBe("ok");

    const [, , options] = completeSimpleMock.mock.calls.at(-1)!;
    expect(options?.headers).toMatchObject({ authorization: "Bearer gem-oauth" });
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
