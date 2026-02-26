import { describe, expect, it, vi } from "vitest";
import { OAuthTokenProvider } from "../src/auth/oauth-token-provider.js";
import { ApiKeyLlmClient, OAuthLlmClient, createLlmProvider } from "../src/llm/client.js";

describe("OAuthLlmClient", () => {
  it("uses bearer token and returns content", async () => {
    const tokenFetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "token-123", expires_in: 3600 }), { status: 200 }),
    );

    const llmFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer token-123" });
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
    });

    const provider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret",
      },
      tokenFetch as unknown as typeof fetch,
    );

    const client = new OAuthLlmClient(
      {
        baseUrl: "https://llm.example.com/v1",
        model: "demo-model",
        tokenProvider: provider,
      },
      llmFetch as unknown as typeof fetch,
    );

    const out = await client.generateReply([{ role: "user", content: "hi" }]);
    expect(out).toBe("hello");
  });

  it("accepts empty-string content as a valid response", async () => {
    const tokenFetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "token-123", expires_in: 3600 }), { status: 200 }),
    );

    const llmFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }));

    const provider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret",
      },
      tokenFetch as unknown as typeof fetch,
    );

    const client = new OAuthLlmClient(
      {
        baseUrl: "https://llm.example.com/v1",
        model: "demo-model",
        tokenProvider: provider,
      },
      llmFetch as unknown as typeof fetch,
    );

    const out = await client.generateReply([{ role: "user", content: "hi" }]);
    expect(out).toBe("");
  });
});

describe("ApiKeyLlmClient", () => {
  it("uses api key bearer auth", async () => {
    const llmFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer key-123" });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });

    const client = new ApiKeyLlmClient(
      {
        baseUrl: "https://llm.example.com/v1",
        model: "demo-model",
        apiKey: "key-123",
      },
      llmFetch as unknown as typeof fetch,
    );

    await expect(client.generateReply([{ role: "user", content: "hi" }])).resolves.toBe("ok");
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
      mode: "oauth",
      baseUrl: "https://llm.example.com/v1",
      model: "demo-model",
      tokenProvider,
    });

    expect(provider).toBeInstanceOf(OAuthLlmClient);
  });

  it("creates api key provider implementation", () => {
    const provider = createLlmProvider({
      mode: "apikey",
      baseUrl: "https://llm.example.com/v1",
      model: "demo-model",
      apiKey: "key-123",
    });

    expect(provider).toBeInstanceOf(ApiKeyLlmClient);
  });
});
