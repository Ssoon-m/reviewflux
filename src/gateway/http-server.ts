import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "../config/env.js";
import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";
import { createLlmProvider, resolveModelRef, type ModelAliasMap } from "../llm/client.js";

export function parsePromptText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getClientErrorCode(_error: unknown): string {
  return "internal_error";
}

export function parseModelAliasesJson(raw?: string): ModelAliasMap {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as Record<string, { provider: "openai" | "gemini"; model: string }>;
  const entries = Object.entries(parsed).map(([alias, target]) => [alias.toLowerCase(), target] as const);
  return Object.fromEntries(entries);
}

export function createApp() {
  const config = readConfig();
  const modelAliases = parseModelAliasesJson(config.LLM_MODEL_ALIASES_JSON);
  const modelRef = resolveModelRef({
    raw: config.LLM_MODEL,
    defaultProvider: config.LLM_PROVIDER,
    aliases: modelAliases,
  });

  const llm =
    config.LLM_AUTH_MODE === "oauth"
      ? (() => {
          if (modelRef.provider !== "openai") {
            throw new Error("oauth_provider_not_supported_for_model");
          }
          return createLlmProvider({
            authMode: "oauth",
            provider: "openai",
            baseUrl: config.LLM_API_BASE_URL,
            model: modelRef.model,
            timeoutMs: config.LLM_TIMEOUT_MS,
            tokenProvider: new OAuthTokenProvider({
              tokenUrl: config.OAUTH_TOKEN_URL!,
              clientId: config.OAUTH_CLIENT_ID!,
              clientSecret: config.OAUTH_CLIENT_SECRET!,
              scope: config.OAUTH_SCOPE,
              audience: config.OAUTH_AUDIENCE,
              timeoutMs: config.LLM_TIMEOUT_MS,
            }),
          });
        })()
      : createLlmProvider({
          authMode: "apikey",
          provider: modelRef.provider,
          baseUrl: config.LLM_API_BASE_URL,
          model: modelRef.model,
          timeoutMs: config.LLM_TIMEOUT_MS,
          apiKey: config.LLM_API_KEY!,
        });

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/v1/ask", async (req, res) => {
    try {
      const prompt = parsePromptText(req.body?.text);
      if (!prompt) return res.status(400).json({ error: "text_must_be_non_empty_string" });

      const answer = await llm.generateReply([
        { role: "system", content: "You are an assistant for issue-flow-ai." },
        { role: "user", content: prompt }
      ]);

      res.json({ answer });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("/v1/ask failed", error);
      res.status(500).json({ error: getClientErrorCode(error) });
    }
  });

  return { app, config };
}

function canonicalPath(pathLike: string): string {
  try {
    return realpathSync(pathLike);
  } catch {
    return resolve(pathLike);
  }
}

export function isDirectRun(metaUrl: string, argv1?: string): boolean {
  if (!argv1) return false;
  return canonicalPath(fileURLToPath(metaUrl)) === canonicalPath(argv1);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const { app, config } = createApp();
  app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`issue-flow-ai server listening on :${config.PORT}`);
  });
}
