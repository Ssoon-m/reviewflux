import { describe, expect, it } from "vitest";
import {
  assertOAuthState,
  buildCodexAuthorizeUrl,
  createPkceChallenge,
  createPkceVerifier,
  extractAuthCode
} from "../src/oauth-codex.js";

describe("oauth-codex helpers", () => {
  it("creates PKCE verifier/challenge pair", () => {
    const verifier = createPkceVerifier();
    const challenge = createPkceChallenge(verifier);

    expect(verifier.length).toBeGreaterThan(20);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("builds codex authorize URL with required params", () => {
    const url = new URL(
      buildCodexAuthorizeUrl({
        redirectUri: "http://localhost:1455/auth/callback",
        state: "state-123",
        codeChallenge: "challenge-123"
      })
    );

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(url.searchParams.get("originator")).toBe("pi");
  });

  it("extracts code/state from redirect URL", () => {
    const got = extractAuthCode("http://localhost:1455/auth/callback?code=abc&state=xyz");
    expect(got).toEqual({ code: "abc", state: "xyz" });
  });

  it("extracts code/state from code#state", () => {
    const got = extractAuthCode("abc#xyz");
    expect(got).toEqual({ code: "abc", state: "xyz" });
  });

  it("extracts raw code", () => {
    const got = extractAuthCode("abc");
    expect(got).toEqual({ code: "abc" });
  });

  it("requires state when configured", () => {
    expect(() => assertOAuthState({ expectedState: "s", actualState: undefined, requireState: true })).toThrow(
      "oauth_state_required"
    );
  });

  it("rejects mismatched state", () => {
    expect(() => assertOAuthState({ expectedState: "s", actualState: "x", requireState: true })).toThrow(
      "oauth_state_mismatch"
    );
  });

  it("accepts matching state", () => {
    expect(() => assertOAuthState({ expectedState: "s", actualState: "s", requireState: true })).not.toThrow();
  });
});
