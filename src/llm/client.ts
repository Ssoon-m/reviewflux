import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";

export type ChatInput = { role: "system" | "user" | "assistant"; content: string };

export interface LlmProvider {
  generateReply(messages: ChatInput[]): Promise<string>;
}

export type LlmProviderName = "openai" | "gemini";

type HttpClientOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

class OpenAICompatibleClient {
  constructor(
    private readonly options: HttpClientOptions,
    private readonly authHeaderProvider: () => Promise<Record<string, string>>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const authHeaders = await this.authHeaderProvider();

      const res = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          temperature: 0.2,
        }),
        signal: ctrl.signal,
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

export class OAuthLlmClient implements LlmProvider {
  private readonly inner: OpenAICompatibleClient;

  constructor(
    private readonly options: HttpClientOptions & {
      tokenProvider: OAuthTokenProvider;
    },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAICompatibleClient(
      options,
      async () => ({ authorization: `Bearer ${await options.tokenProvider.getAccessToken()}` }),
      fetchImpl,
    );
  }

  generateReply(messages: ChatInput[]): Promise<string> {
    return this.inner.generateReply(messages);
  }
}

export class ApiKeyLlmClient implements LlmProvider {
  protected readonly inner: OpenAICompatibleClient;

  constructor(
    protected readonly options: HttpClientOptions & {
      apiKey: string;
    },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAICompatibleClient(options, async () => ({ authorization: `Bearer ${options.apiKey}` }), fetchImpl);
  }

  generateReply(messages: ChatInput[]): Promise<string> {
    return this.inner.generateReply(messages);
  }
}

export class GeminiLlmClient extends ApiKeyLlmClient {}

export class OpenAIApiKeyLlmClient extends ApiKeyLlmClient {}

export type LlmProviderFactoryInput =
  | ({ mode: "oauth"; provider?: "openai"; tokenProvider: OAuthTokenProvider } & HttpClientOptions)
  | ({ mode: "apikey"; provider: LlmProviderName; apiKey: string } & HttpClientOptions);

export function createLlmProvider(input: LlmProviderFactoryInput, fetchImpl: typeof fetch = fetch): LlmProvider {
  if (input.mode === "oauth") {
    return new OAuthLlmClient(input, fetchImpl);
  }

  if (input.provider === "gemini") {
    return new GeminiLlmClient(input, fetchImpl);
  }

  return new OpenAIApiKeyLlmClient(input, fetchImpl);
}
