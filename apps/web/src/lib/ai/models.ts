import { CLAUDE_MODELS } from "@/lib/ai/claude";

// Model routing via env vars — upgrade individual slots by changing the env
// var, no code change needed. All default to Haiku to minimize COGS.
export const BULK_MODEL = process.env.BULK_MODEL ?? CLAUDE_MODELS.cheap;
export const WRITING_MODEL = process.env.WRITING_MODEL ?? CLAUDE_MODELS.cheap;
export const HIGH_INTENT_MODEL = process.env.HIGH_INTENT_MODEL ?? CLAUDE_MODELS.cheap;
