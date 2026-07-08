import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "sk-test-placeholder-not-a-real-key",
  maxRetries: 3,
  timeout: 45_000,
});
