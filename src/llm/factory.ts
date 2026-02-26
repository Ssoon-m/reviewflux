import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";
import { GeminiNativeClient } from "./providers/gemini-native.js";
import { OpenAICompatibleClient } from "./providers/openai-compatible.js";
import type { LlmProvider, LlmProviderName } from "./types.js";

export class OAuthLlmClient implements LlmProvider {
  private readonly inner: OpenAICompatibleClient;

  constructor(
    options: { baseUrl: string; model: string; timeoutMs?: number; tokenProvider: OAuthTokenProvider },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAICompatibleClient(
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
  private readonly inner: OpenAICompatibleClient;

  constructor(
    options: { baseUrl: string; model: string; timeoutMs?: number; apiKey: string },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAICompatibleClient(options, async () => ({ authorization: `Bearer ${options.apiKey}` }), fetchImpl);
  }

  generateReply(messages: Parameters<LlmProvider["generateReply"]>[0]): ReturnType<LlmProvider["generateReply"]> {
    return this.inner.generateReply(messages);
  }
}

export class GeminiLlmClient implements LlmProvider {
  private readonly inner: GeminiNativeClient;

  constructor(
    options: { baseUrl: string; model: string; timeoutMs?: number; apiKey: string },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new GeminiNativeClient(options, fetchImpl);
  }

  generateReply(messages: Parameters<LlmProvider["generateReply"]>[0]): ReturnType<LlmProvider["generateReply"]> {
    return this.inner.generateReply(messages);
  }
}

export type LlmProviderFactoryInput =
  | {
      authMode: "oauth";
      provider: "openai";
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
    return new OAuthLlmClient(input, fetchImpl);
  }

  if (input.provider === "gemini") {
    return new GeminiLlmClient(input, fetchImpl);
  }

  return new OpenAIApiKeyLlmClient(input, fetchImpl);
}
