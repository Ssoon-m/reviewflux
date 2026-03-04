import type { ChatInput } from "../types.js";

type OpenAIProviderClientOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
};

export class OpenAIProviderClient {
  constructor(
    private readonly options: OpenAIProviderClientOptions,
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
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          temperature: 0.2,
          ...(this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}),
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`llm_request_failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (content == null) throw new Error("llm_response_missing_content");
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
