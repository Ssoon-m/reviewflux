import type { KnownModelRef } from "./models-config.providers.js";

const okOpenAi: KnownModelRef = { provider: "openai", model: "gpt-4o-mini" };
const okGemini: KnownModelRef = { provider: "gemini", model: "gemini-2.5-flash" };

void okOpenAi;
void okGemini;

// @ts-expect-error invalid openai model literal
const badOpenAi: KnownModelRef = { provider: "openai", model: "gemini-2.5-flash" };
// @ts-expect-error invalid gemini model literal
const badGemini: KnownModelRef = { provider: "gemini", model: "gpt-4o-mini" };

void badOpenAi;
void badGemini;
