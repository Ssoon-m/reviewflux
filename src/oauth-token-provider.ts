type CachedToken = {
  accessToken: string;
  expiresAtEpochMs: number;
};

export type OAuthClientCredentials = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  timeoutMs?: number;
};

export class OAuthTokenProvider {
  private token?: CachedToken;
  private inFlight?: Promise<string>;

  constructor(
    private readonly creds: OAuthClientCredentials,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.token.expiresAtEpochMs - 10_000) {
      return this.token.accessToken;
    }

    if (!this.inFlight) {
      this.inFlight = this.requestNewToken().finally(() => {
        this.inFlight = undefined;
      });
    }

    return this.inFlight;
  }

  private async requestNewToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret
    });

    if (this.creds.scope) body.set("scope", this.creds.scope);
    if (this.creds.audience) body.set("audience", this.creds.audience);

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.creds.timeoutMs ?? 30_000);

    try {
      const res = await this.fetchImpl(this.creds.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl.signal
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`oauth_token_request_failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error("oauth_token_missing_access_token");

      const expiresInSec = json.expires_in ?? 3600;
      this.token = {
        accessToken: json.access_token,
        expiresAtEpochMs: Date.now() + expiresInSec * 1000
      };

      return this.token.accessToken;
    } finally {
      clearTimeout(timeout);
    }
  }
}
