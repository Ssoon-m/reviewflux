import { createHash, randomBytes, randomUUID } from "node:crypto";

export const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_CLIENT_ID = "codex-cli";
export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkceVerifier(): string {
  return toBase64Url(randomBytes(32));
}

export function createPkceChallenge(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier).digest());
}

export function createOAuthState(): string {
  return randomUUID();
}

export function buildCodexAuthorizeUrl(params: {
  clientId?: string;
  authorizeUrl?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.authorizeUrl ?? CODEX_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId ?? CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "pi");
  return url.toString();
}

export function assertOAuthState(params: {
  expectedState: string;
  actualState?: string;
  requireState: boolean;
}): void {
  if (!params.actualState) {
    if (params.requireState) throw new Error("oauth_state_required");
    return;
  }

  if (params.actualState !== params.expectedState) {
    throw new Error("oauth_state_mismatch");
  }
}

export function extractAuthCode(input: string): { code: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("oauth_code_required");

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("oauth_redirect_missing_code");
    const state = url.searchParams.get("state") ?? undefined;
    return { code, state };
  }

  const hashSplit = trimmed.split("#");
  if (hashSplit.length === 2 && hashSplit[0]) {
    return { code: hashSplit[0], state: hashSplit[1] || undefined };
  }

  return { code: trimmed };
}
