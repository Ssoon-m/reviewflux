export type ChatInput = { role: "system" | "user" | "assistant"; content: string };

export interface LlmProvider {
  generateReply(messages: ChatInput[]): Promise<string>;
}

export type LlmProviderName = string;
