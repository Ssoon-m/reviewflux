import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type { AssistantMessage, Context, Message } from "@mariozechner/pi-ai";
import type { OAuthTokenProvider } from "../auth/oauth-token-provider";
import { CUSTOM_PROVIDER_ID_ANTHROPIC, CUSTOM_PROVIDER_ID_OPENAI } from "./custom-provider";
import { GeminiProviderClient } from "./providers/gemini-provider";
import { OpenAIProviderClient } from "./providers/openai-provider";
import { AnthropicProviderClient } from "./providers/anthropic-provider";
import type { ChatInput, LlmProvider, LlmProviderName } from "./types";

function toPiContext(messages: ChatInput[], provider: string, model: string): Context {
  const now = Date.now();
  const systemPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join("\n\n");

  const conversation: Message[] = messages
    .filter((m) => m.role !== "system")
    .map((m, i) => {
      const timestamp = now + i;
      if (m.role === "assistant") {
        return {
          role: "assistant",
          api: "openai-completions",
          provider,
          model,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          content: [{ type: "text", text: m.content }],
          timestamp,
        } satisfies AssistantMessage;
      }

      return {
        role: "user",
        content: m.content,
        timestamp,
      } as const;
    });

  return {
    systemPrompt: systemPrompt || undefined,
    messages: conversation,
  };
}

function extractText(message: AssistantMessage): string {
  const out = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

  if (!out) {
    throw new Error("llm_response_missing_content");
  }

  return out;
}

class PiAiLlmClient implements LlmProvider {
  constructor(
    private readonly options:
      | {
          authMode: "apikey";
          provider: LlmProviderName;
          model: string;
          baseUrl: string;
          timeoutMs?: number;
          apiKey: string;
        }
      | {
          authMode: "oauth";
          provider: LlmProviderName;
          model: string;
          baseUrl: string;
          timeoutMs?: number;
          tokenProvider: OAuthTokenProvider;
        },
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const baseModel = getModel(this.options.provider as never, this.options.model as never);
    if (!baseModel) {
      throw new Error(`model_not_supported_by_pi_ai:${this.options.provider}/${this.options.model}`);
    }

    const model =
      this.options.baseUrl && this.options.baseUrl !== baseModel.baseUrl
        ? { ...baseModel, baseUrl: this.options.baseUrl }
        : baseModel;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const result =
        this.options.authMode === "apikey"
          ? await completeSimple(model, toPiContext(messages, this.options.provider, this.options.model), {
              apiKey: this.options.apiKey,
              signal: ctrl.signal,
            })
          : await completeSimple(model, toPiContext(messages, this.options.provider, this.options.model), {
              apiKey: await this.options.tokenProvider.getAccessToken(),
              signal: ctrl.signal,
            });

      return extractText(result);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class OAuthLlmClient implements LlmProvider {
  private readonly inner: OpenAIProviderClient;

  constructor(
    options: {
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      tokenProvider: OAuthTokenProvider;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    },
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
    options: {
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      apiKey: string;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new OpenAIProviderClient(options, async () => ({ authorization: `Bearer ${options.apiKey}` }), fetchImpl);
  }

  generateReply(messages: Parameters<LlmProvider["generateReply"]>[0]): ReturnType<LlmProvider["generateReply"]> {
    return this.inner.generateReply(messages);
  }
}

export class AnthropicApiKeyLlmClient implements LlmProvider {
  private readonly inner: AnthropicProviderClient;

  constructor(
    options: { baseUrl: string; model: string; timeoutMs?: number; apiKey: string },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.inner = new AnthropicProviderClient(
      options,
      async () => ({ "x-api-key": options.apiKey }),
      fetchImpl,
    );
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
      provider: LlmProviderName;
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      tokenProvider: OAuthTokenProvider;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    }
  | {
      authMode: "apikey";
      provider: LlmProviderName;
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      apiKey: string;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    };

export function createLlmProvider(input: LlmProviderFactoryInput, fetchImpl: typeof fetch = fetch): LlmProvider {
  if (input.authMode === "oauth") {
    if (input.provider === "gemini" || input.provider === "google" || input.provider === "google-gemini-cli") {
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

    if (input.provider === "openai" || input.provider === "openai-codex") {
      return new OAuthLlmClient(input, fetchImpl);
    }

    return new PiAiLlmClient(input);
  }

  if (input.provider === "gemini" || input.provider === "google") {
    return new GeminiLlmClient({ ...input, authMode: "apikey" }, fetchImpl);
  }

  if (input.provider === "openai") {
    return new OpenAIApiKeyLlmClient(input, fetchImpl);
  }

  if (input.provider === CUSTOM_PROVIDER_ID_OPENAI) {
    return new OpenAIApiKeyLlmClient(input, fetchImpl);
  }

  if (input.provider === CUSTOM_PROVIDER_ID_ANTHROPIC) {
    return new AnthropicApiKeyLlmClient(input, fetchImpl);
  }

  return new PiAiLlmClient(input);
}
