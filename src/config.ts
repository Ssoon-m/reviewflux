import { z } from "zod";

const schema = z.object({
  OAUTH_TOKEN_URL: z.string().url(),
  OAUTH_CLIENT_ID: z.string().min(1),
  OAUTH_CLIENT_SECRET: z.string().min(1),
  OAUTH_SCOPE: z.string().optional(),
  OAUTH_AUDIENCE: z.string().optional(),
  LLM_API_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),
  LLM_TIMEOUT_MS: z.coerce.number().default(30_000),
  PORT: z.coerce.number().default(3000)
});

export type AppConfig = z.infer<typeof schema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
