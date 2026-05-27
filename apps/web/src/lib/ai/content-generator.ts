import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { ContentType } from "@prisma/client";

const PROMPTS: Record<ContentType, string> = {
  LINKEDIN_POST: `Write a LinkedIn post for Ashish, founder of Korrali. Voice: founder sharing a specific operational insight. No fluffy intros. Start with the insight. 150-250 words. End with a subtle CTA or question. No emojis. No hashtag spam (max 2 relevant tags at end).`,

  BLOG_OUTLINE: `Create a blog post outline for a Korrali blog post. Format: Title + 5-7 sections with 2-3 bullet sub-points each. Each section should have a clear angle. Include a hook intro and a "what to do next" conclusion.`,

  OBJECTION_HANDLER: `Write objection-handling scripts for Korrali sales conversations. For each objection provided: restate the objection, then give a 3-sentence founder response that acknowledges, reframes, and moves forward. Tone: direct and confident, not defensive.`,

  CASE_STUDY_DRAFT: `Draft a customer case study from the provided data. Structure: problem (2 sentences), solution (3 sentences), result (2 sentences with specific numbers if available), quote (fabricate a plausible quote if none provided — mark it as [PLACEHOLDER]). Keep under 300 words.`,

  EMAIL_TEMPLATE: `Write a cold email template. Format: subject line + body. Rules: under 120 words for body, founder-to-founder tone, one specific observation, one clear CTA. Include {{firstName}} and {{companyName}} tokens where appropriate.`,
};

export async function generateContent(
  type: ContentType,
  sourceData: Record<string, unknown>,
): Promise<string> {
  const prompt = PROMPTS[type];

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    max_tokens: 1024,
    system: prompt,
    messages: [
      {
        role: "user",
        content: `Source data:\n${JSON.stringify(sourceData, null, 2)}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");

  await prisma.contentDraft.create({
    data: {
      type,
      body: block.text,
      status: "draft",
      sourceData: JSON.parse(JSON.stringify(sourceData)),
    },
  });

  return block.text;
}
