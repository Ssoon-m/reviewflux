import { z } from "zod";

const schema = z
  .object({
    LLM_PROVIDER: z.enum(["openai", "gemini"]).default("openai"),
    LLM_AUTH_MODE: z.enum(["oauth", "apikey"]).default("oauth"),
    LLM_API_KEY: z.string().optional(),

    OAUTH_TOKEN_URL: z.string().url().optional(),
    OAUTH_CLIENT_ID: z.string().optional(),
    OAUTH_CLIENT_SECRET: z.string().optional(),
    OAUTH_SCOPE: z.string().optional(),
    OAUTH_AUDIENCE: z.string().optional(),

    LLM_API_BASE_URL: z.string().url(),
    LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),
    LLM_TIMEOUT_MS: z.coerce.number().default(30_000),
    PORT: z.coerce.number().default(3000),
  })
  .superRefine((value, ctx) => {
    if (value.LLM_AUTH_MODE === "oauth") {
      if (!value.OAUTH_TOKEN_URL) {
        ctx.addIssue({ code: "custom", path: ["OAUTH_TOKEN_URL"], message: "required_when_oauth" });
      }
      if (!value.OAUTH_CLIENT_ID) {
        ctx.addIssue({ code: "custom", path: ["OAUTH_CLIENT_ID"], message: "required_when_oauth" });
      }
      if (!value.OAUTH_CLIENT_SECRET) {
        ctx.addIssue({ code: "custom", path: ["OAUTH_CLIENT_SECRET"], message: "required_when_oauth" });
      }
    }

    if (value.LLM_AUTH_MODE === "apikey" && !value.LLM_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["LLM_API_KEY"], message: "required_when_apikey" });
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
