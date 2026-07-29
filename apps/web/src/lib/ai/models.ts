import { CLAUDE_MODELS } from "@/lib/ai/claude";

// Judicious tiering across the FREE Groq tier (Claude + OpenAI stay as fallback
// only — see claude.ts). All three slots resolve to Groq/Llama ids:
//   BULK        → 8B  (llama-3.1-8b-instant): high-volume, low-stakes work —
//                 fit scoring, reply/intent classification, company discovery,
//                 SEO topic analysis. 131K TPM headroom, cheapest COGS.
//   WRITING     → 70B tier (mapped to llama-4-scout-17b in toGroqModel):
//                 customer-facing prose — cold emails, SEO articles.
//   HIGH_INTENT → 70B tier: high-value decisions/output — call briefs,
//                 LinkedIn drafts. Worth the extra capability over 8B.
// Use || not ?? so empty-string env vars also fall back to the default.
export const BULK_MODEL = process.env.BULK_MODEL || CLAUDE_MODELS.cheap;
export const WRITING_MODEL = process.env.WRITING_MODEL || CLAUDE_MODELS.premium;
export const HIGH_INTENT_MODEL = process.env.HIGH_INTENT_MODEL || CLAUDE_MODELS.premium;
