import type { ChatInput } from "../types";

type AnthropicProviderClientOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

/** Anthropic Messages API–compatible client (any endpoint that accepts the same shape). */
export class AnthropicProviderClient {
  constructor(
    private readonly options: AnthropicProviderClientOptions,
    private readonly authHeaderProvider: () => Promise<Record<string, string>>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const base = this.options.baseUrl.replace(/\/+$/, "");
      const url = base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
      const authHeaders = await this.authHeaderProvider();
      const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content.trim());
      const conversation = messages.filter((m) => m.role !== "system");
      const anthropicMessages = conversation.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      if (anthropicMessages.length === 0) throw new Error("llm_request_messages_required");

      const body: { model: string; max_tokens: number; messages: typeof anthropicMessages; system?: string } = {
        model: this.options.model,
        max_tokens: 4096,
        messages: anthropicMessages,
      };
      if (systemParts.length > 0) body.system = systemParts.join("\n\n");

      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...authHeaders,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`llm_request_failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      const text = json.content?.find((c) => c.type === "text")?.text ?? json.content?.[0]?.text;
      if (text == null) throw new Error("llm_response_missing_content");
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
