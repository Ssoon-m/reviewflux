import { z } from "zod";

const schema = z
  .object({
    LLM_PROVIDER: z.string().default("openai"),
    LLM_AUTH_MODE: z.enum(["oauth", "apikey"]).default("oauth"),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL_ALIASES_JSON: z.string().optional(),
    LLM_ALLOWED_MODELS: z.string().optional(),

    OAUTH_TOKEN_URL: z.string().url().optional(),
    OAUTH_CLIENT_ID: z.string().optional(),
    OAUTH_CLIENT_SECRET: z.string().optional(),
    OAUTH_SCOPE: z.string().optional(),
    OAUTH_AUDIENCE: z.string().optional(),

    LLM_API_BASE_URL: z.string().url(),
    LLM_MODEL: z.string().optional(),
    LLM_TIMEOUT_MS: z.coerce.number().default(30_000),
    PORT: z.coerce.number().default(3000),
    EVENT_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).default(1),
    EVENT_QUEUE_RETRY_COUNT: z.coerce.number().int().min(0).default(2),
    EVENT_QUEUE_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(1_000),
  })
  .superRefine((value, ctx) => {
    if (value.LLM_AUTH_MODE === "oauth") {
      if (!value.OAUTH_TOKEN_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_TOKEN_URL"],
          message: "required_when_oauth",
        });
      }
      if (!value.OAUTH_CLIENT_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_CLIENT_ID"],
          message: "required_when_oauth",
        });
      }
      if (!value.OAUTH_CLIENT_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_CLIENT_SECRET"],
          message: "required_when_oauth",
        });
      }
    }
  })
  .transform((value) => {
    const provider = value.LLM_PROVIDER.trim().toLowerCase();
    const defaultModel = provider.startsWith("google")
      ? "gemini-2.5-flash"
      : "gpt-4o-mini";

    return {
      ...value,
      LLM_MODEL: value.LLM_MODEL?.trim() || defaultModel,
    };
  });

export type AppConfig = z.infer<typeof schema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
