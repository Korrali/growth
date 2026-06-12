import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import type { CommunitySource } from "@prisma/client";
import { MARKETED_PRODUCT_KEYS, productCatalogueBlock } from "@/lib/products";

const SOURCE_LABEL: Record<CommunitySource, string> = {
  REDDIT:        "Reddit",
  HACKERNEWS:    "Hacker News",
  INDIE_HACKERS: "Indie Hackers",
};

const SYSTEM_PROMPT = `You are scoring community posts for intent signals relevant to these products:

${productCatalogueBlock()}

Score 1–10 how likely the post author needs one of these products RIGHT NOW based on their post. For MEDSCAN, consumer posts count too (confused about medications, caregiving for a parent, pill identification).

If score >= 7, also write 3 distinct reply comment variations:
- Each 2-4 sentences
- Address the OP directly (use their username as u/{author} or reference their specific situation)
- Each variation takes a different angle (analogy / concrete step / clarifying question)
- Never name the product or company, and never include product links
- One variation may end with "happy to share how we solved this — DM me"

Respond with valid JSON only.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    intentScore:   { type: "number", description: "1-10 intent signal strength" },
    intentReason:  { type: "string", description: "Why this post signals intent" },
    icpSignal:     { type: "string", enum: [...MARKETED_PRODUCT_KEYS, "BOTH", "NONE"] },
    replyVariants: {
      type: "array",
      items: { type: "string" },
      description: "3 reply variations if intentScore >= 7, empty array otherwise",
    },
  },
  required: ["intentScore", "intentReason", "icpSignal", "replyVariants"],
  additionalProperties: false,
};

export interface IntentScoreResult {
  intentScore: number;
  intentReason: string;
  icpSignal: string;
  replyVariants: string[];
}

export async function scoreCommunityMention(mentionId: string): Promise<IntentScoreResult> {
  const mention = await prisma.communityMention.findUniqueOrThrow({ where: { id: mentionId } });

  const inputData = {
    platform: SOURCE_LABEL[mention.source],
    title:    mention.title,
    body:     mention.body,
    author:   mention.author,
    context:  mention.subreddit ? `r/${mention.subreddit}` : SOURCE_LABEL[mention.source],
  };

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Score this ${SOURCE_LABEL[mention.source]} post:\n${JSON.stringify(inputData, null, 2)}`,
    }],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block in response");

  const result = JSON.parse(block.text) as IntentScoreResult;

  if (result.intentScore < 1 || result.intentScore > 10) {
    throw new Error(`intentScore out of range: ${result.intentScore}`);
  }
  if (result.intentScore >= 7 && result.replyVariants.length !== 3) {
    throw new Error(`Expected 3 replyVariants for score ${result.intentScore}, got ${result.replyVariants.length}`);
  }

  await prisma.communityMention.update({
    where: { id: mentionId },
    data: {
      intentScore:   result.intentScore,
      intentReason:  result.intentReason,
      icpSignal:     result.icpSignal,
      replyVariants: result.replyVariants,
      status:        result.intentScore >= 7 ? "pending" : "dismissed",
    },
  });

  return result;
}
