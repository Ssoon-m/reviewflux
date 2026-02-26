import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";

export type ChatInput = { role: "system" | "user" | "assistant"; content: string };

export class OAuthLlmClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      tokenProvider: OAuthTokenProvider;
    },
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const token = await this.options.tokenProvider.getAccessToken();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const res = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          temperature: 0.2
        }),
        signal: ctrl.signal
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`llm_request_failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = json.choices?.[0]?.message?.content;
      if (content == null) throw new Error("llm_response_missing_content");
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
