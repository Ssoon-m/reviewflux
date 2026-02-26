import type { ChatInput } from "../types.js";

type GeminiNativeClientOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
} &
  ({ authMode: "apikey"; apiKey: string } | { authMode: "oauth"; accessTokenProvider: () => Promise<string> });

export class GeminiNativeClient {
  constructor(
    private readonly options: GeminiNativeClientOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateReply(messages: ChatInput[]): Promise<string> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 30_000);

    try {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content.trim())
        .filter(Boolean)
        .join("\n\n");

      const conversation = messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const contents = system
        ? [{ role: "user", parts: [{ text: `[SYSTEM]\n${system}` }] }, ...conversation]
        : conversation;

      const base = `${this.options.baseUrl.replace(/\/$/, "")}/models/${this.options.model}:generateContent`;
      const endpoint =
        this.options.authMode === "apikey"
          ? `${base}?key=${encodeURIComponent(this.options.apiKey)}`
          : base;

      const authHeader =
        this.options.authMode === "oauth"
          ? { authorization: `Bearer ${await this.options.accessTokenProvider()}` }
          : {};

      const res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader },
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
      if (!text) throw new Error("llm_response_missing_content");
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
