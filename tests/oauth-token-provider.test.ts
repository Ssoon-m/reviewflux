import { describe, expect, it, vi } from "vitest";
import { OAuthTokenProvider } from "../src/auth/oauth-token-provider.js";

describe("OAuthTokenProvider", () => {
  it("caches token and avoids duplicate fetches", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "abc", expires_in: 3600 }), { status: 200 })
    );

    const provider = new OAuthTokenProvider(
      {
        tokenUrl: "https://auth.example.com/oauth/token",
        clientId: "id",
        clientSecret: "secret"
      },
      fakeFetch as unknown as typeof fetch
    );

    const t1 = await provider.getAccessToken();
    const t2 = await provider.getAccessToken();

    expect(t1).toBe("abc");
    expect(t2).toBe("abc");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
