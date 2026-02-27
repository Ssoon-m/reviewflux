import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";
import { GeminiProviderClient } from "./providers/gemini-provider.js";
import { OpenAIProviderClient } from "./providers/openai-provider.js";
import type { LlmProvider, LlmProviderName } from "./types.js";

export class OAuthLlmClient implements LlmProvider {
  private readonly inner: OpenAIProviderClient;

  constructor(
    options: { baseUrl: string; model: string; timeoutMs?: number; tokenProvider: OAuthTokenProvider },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAIProviderClient(
      options,
      async () => ({ authorization: `Bearer ${await options.tokenProvider.getAccessToken()}` }),
      fetchImpl,
    );
  }

  generateReply(messages: Parameters<LlmProvider["generateReply"]>[0]): ReturnType<LlmProvider["generateReply"]> {
    return this.inner.generateReply(messages);
  }
}

export class OpenAIApiKeyLlmClient implements LlmProvider {
  private readonly inner: OpenAIProviderClient;

  constructor(
    options: { baseUrl: string; model: string; timeoutMs?: number; apiKey: string },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAIProviderClient(options, async () => ({ authorization: `Bearer ${options.apiKey}` }), fetchImpl);
  }

  generateReply(messages: Parameters<LlmProvider["generateReply"]>[0]): ReturnType<LlmProvider["generateReply"]> {
    return this.inner.generateReply(messages);
  }
}

export class GeminiLlmClient implements LlmProvider {
  private readonly inner: GeminiProviderClient;

  constructor(
    options:
      | { baseUrl: string; model: string; timeoutMs?: number; apiKey: string; authMode: "apikey" }
      | { baseUrl: string; model: string; timeoutMs?: number; accessTokenProvider: () => Promise<string>; authMode: "oauth" },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new GeminiProviderClient(options, fetchImpl);
  }

  generateReply(messages: Parameters<LlmProvider["generateReply"]>[0]): ReturnType<LlmProvider["generateReply"]> {
    return this.inner.generateReply(messages);
  }
}

export type LlmProviderFactoryInput =
  | {
      authMode: "oauth";
      provider: "openai" | "gemini";
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      tokenProvider: OAuthTokenProvider;
    }
  | {
      authMode: "apikey";
      provider: LlmProviderName;
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      apiKey: string;
    };

export function createLlmProvider(input: LlmProviderFactoryInput, fetchImpl: typeof fetch = fetch): LlmProvider {
  if (input.authMode === "oauth") {
    if (input.provider === "gemini") {
      return new GeminiLlmClient(
        {
          authMode: "oauth",
          baseUrl: input.baseUrl,
          model: input.model,
          timeoutMs: input.timeoutMs,
          accessTokenProvider: () => input.tokenProvider.getAccessToken(),
        },
        fetchImpl,
      );
    }

    return new OAuthLlmClient(input, fetchImpl);
  }

  if (input.provider === "gemini") {
    return new GeminiLlmClient({ ...input, authMode: "apikey" }, fetchImpl);
  }

  return new OpenAIApiKeyLlmClient(input, fetchImpl);
}
