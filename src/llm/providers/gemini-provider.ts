import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type { AssistantMessage, Context, Message } from "@mariozechner/pi-ai";
import type { ChatInput } from "../types";

type GeminiProviderClientOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
} &
  ({ authMode: "apikey"; apiKey: string } | { authMode: "oauth"; accessTokenProvider: () => Promise<string> });

function toPiContext(messages: ChatInput[]): Context {
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
          api: "google-generative-ai",
          provider: "google",
          model: "gemini",
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

export class GeminiProviderClient {
  constructor(
    private readonly options: GeminiProviderClientOptions,
    _fetchImpl?: typeof fetch,
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const baseModel = getModel("google", this.options.model as never);
    if (!baseModel) {
      throw new Error(`model_not_supported_by_pi_ai:google/${this.options.model}`);
    }

    const model =
      this.options.baseUrl && this.options.baseUrl !== baseModel.baseUrl
        ? { ...baseModel, baseUrl: this.options.baseUrl }
        : baseModel;

    const context = toPiContext(messages);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const result =
        this.options.authMode === "apikey"
          ? await completeSimple(model, context, {
              apiKey: this.options.apiKey,
              signal: ctrl.signal,
            })
          : await completeSimple(model, context, {
              headers: { authorization: `Bearer ${await this.options.accessTokenProvider()}` },
              signal: ctrl.signal,
            });

      return extractText(result);
    } finally {
      clearTimeout(timeout);
    }
  }
}
