import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";

export type ChatInput = { role: "system" | "user" | "assistant"; content: string };

export interface LlmProvider {
  generateReply(messages: ChatInput[]): Promise<string>;
}

export type LlmProviderName = "openai" | "gemini";

export type ModelRef = {
  provider: LlmProviderName;
  model: string;
};

export type ModelAliasMap = Record<string, ModelRef>;

export function resolveModelRef(params: {
  raw: string;
  defaultProvider: LlmProviderName;
  aliases?: ModelAliasMap;
}): ModelRef {
  const trimmed = params.raw.trim();
  if (!trimmed) throw new Error("model_required");

  const aliasTarget = params.aliases?.[trimmed.toLowerCase()];
  if (aliasTarget) return aliasTarget;

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const provider = trimmed.slice(0, slash) as LlmProviderName;
    const model = trimmed.slice(slash + 1);
    if ((provider === "openai" || provider === "gemini") && model) {
      return { provider, model };
    }
  }

  return { provider: params.defaultProvider, model: trimmed };
}

type HttpClientOptions = {
  model: string;
  timeoutMs?: number;
};

type OpenAIHttpOptions = HttpClientOptions & {
  baseUrl: string;
};

type GeminiHttpOptions = HttpClientOptions & {
  baseUrl: string;
};

class OpenAICompatibleClient {
  constructor(
    private readonly options: OpenAIHttpOptions,
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

class GeminiNativeClient {
  constructor(
    private readonly options: GeminiHttpOptions & { apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const sys = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean).join("\n\n");
      const conversation = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const contents = sys
        ? [{ role: "user", parts: [{ text: `[SYSTEM]\n${sys}` }] }, ...conversation]
        : conversation;

      const endpoint = `${this.options.baseUrl.replace(/\/$/, "")}/models/${this.options.model}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`;

      const res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`llm_request_failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (text == null || text === "") throw new Error("llm_response_missing_content");
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class OAuthLlmClient implements LlmProvider {
  private readonly inner: OpenAICompatibleClient;

  constructor(
    options: OpenAIHttpOptions & {
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

export class OpenAIApiKeyLlmClient implements LlmProvider {
  private readonly inner: OpenAICompatibleClient;

  constructor(
    options: OpenAIHttpOptions & {
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

export class GeminiLlmClient implements LlmProvider {
  private readonly inner: GeminiNativeClient;

  constructor(
    options: GeminiHttpOptions & {
      apiKey: string;
    },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new GeminiNativeClient(options, fetchImpl);
  }

  generateReply(messages: ChatInput[]): Promise<string> {
    return this.inner.generateReply(messages);
  }
}

export type LlmProviderFactoryInput =
  | ({ authMode: "oauth"; tokenProvider: OAuthTokenProvider; baseUrl: string; model: string; timeoutMs?: number } & {
      provider: "openai";
    })
  | ({ authMode: "apikey"; apiKey: string; baseUrl: string; model: string; timeoutMs?: number; provider: LlmProviderName });

export function createLlmProvider(input: LlmProviderFactoryInput, fetchImpl: typeof fetch = fetch): LlmProvider {
  if (input.authMode === "oauth") {
    return new OAuthLlmClient(input, fetchImpl);
  }

  if (input.provider === "gemini") {
    return new GeminiLlmClient(input, fetchImpl);
  }

  return new OpenAIApiKeyLlmClient(input, fetchImpl);
}
