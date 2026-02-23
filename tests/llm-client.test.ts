import { describe, expect, it, vi } from "vitest";
import { OAuthTokenProvider } from "../src/oauth-token-provider.js";
import { OAuthLlmClient } from "../src/llm-client.js";

describe("OAuthLlmClient", () => {
  it("uses bearer token and returns content", async () => {
    const tokenFetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "token-123", expires_in: 3600 }), { status: 200 })
    );

    const llmFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer token-123" });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "hello" } }] }),
        { status: 200 }
      );
    });

    const provider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/token",
        clientId: "id",
        clientSecret: "secret"
      },
      tokenFetch as unknown as typeof fetch
    );

    const client = new OAuthLlmClient(
      {
        baseUrl: "https://llm.example.com/v1",
        model: "demo-model",
        tokenProvider: provider
      },
      llmFetch as unknown as typeof fetch
    );

    const out = await client.generateReply([{ role: "user", content: "hi" }]);
    expect(out).toBe("hello");
  });
});
