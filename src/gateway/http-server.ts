import "dotenv/config";
import express from "express";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../config/env.js";
import { createLlmService } from "../llm/service.js";

export function parsePromptText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getClientErrorCode(_error: unknown): string {
  return "internal_error";
}

export function createApp() {
  const config = readConfig();
  let llm = null as ReturnType<typeof createLlmService> | null;

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/v1/ask", async (req, res) => {
    try {
      const prompt = parsePromptText(req.body?.text);
      if (!prompt) {
        return res.status(400).json({ error: "text_must_be_non_empty_string" });
      }

      if (!llm) {
        llm = createLlmService(config);
      }

      const answer = await llm.generateReply([
        { role: "system", content: "You are an assistant for issue-flow-ai." },
        { role: "user", content: prompt },
      ]);

      return res.json({ answer });
    } catch (error) {
      console.error("/v1/ask failed", error);
      return res.status(500).json({ error: getClientErrorCode(error) });
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
    console.log(`issue-flow-ai server listening on :${config.PORT}`);
  });
}
