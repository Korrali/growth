import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";

export interface SeoTopic {
  topic: string;
  targetKeyword: string;
  suggestedTitle: string;
  metaDescription: string;
  searchIntent: string;         // what the searcher is trying to do
  product: "TRUST" | "REVENUE";
  sourceCount: number;          // how many community mentions back this topic
  sourceSample: string[];       // up to 3 post titles that triggered it
}

export async function analyzeSeoTopics(): Promise<SeoTopic[]> {
  // Pull recent high-intent community mentions across all sources
  const mentions = await prisma.communityMention.findMany({
    where: { intentScore: { gte: 4 } },
    orderBy: { intentScore: "desc" },
    take: 200,
    select: { title: true, body: true, source: true, intentScore: true },
  });

  const hasMentions = mentions.length > 0;
  const mentionSummary = hasMentions
    ? mentions.map((m) => `[${m.source}] ${m.title}`).join("\n")
    : null;

  const userContent = hasMentions
    ? `Here are ${mentions.length} community posts from people expressing pain. Extract the top SEO article opportunities:\n\n${mentionSummary}\n\nReturn JSON array with this shape for each topic:\n{\n  "topic": "brief topic name",\n  "targetKeyword": "exact keyword phrase to rank for",\n  "suggestedTitle": "SEO article title (50-60 chars)",\n  "metaDescription": "meta description (150-160 chars)",\n  "searchIntent": "what the searcher wants",\n  "product": "TRUST or REVENUE",\n  "sourceCount": number of posts backing this,\n  "sourceSample": ["post title 1", "post title 2"]\n}`
    : `No community data is available yet. Generate 8 high-value SEO article topics based purely on your product knowledge of the two products and common search patterns in the B2B SaaS compliance and billing/payments space.\n\nReturn JSON array with this shape for each topic:\n{\n  "topic": "brief topic name",\n  "targetKeyword": "exact keyword phrase to rank for",\n  "suggestedTitle": "SEO article title (50-60 chars)",\n  "metaDescription": "meta description (150-160 chars)",\n  "searchIntent": "what the searcher wants",\n  "product": "TRUST or REVENUE",\n  "sourceCount": 0,\n  "sourceSample": []\n}`;

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    max_tokens: 2048,
    system: `You are an SEO strategist for two B2B SaaS products:

**Korrali Trust** — helps B2B SaaS companies answer security questionnaires, manage SOC2/ISO27001 policies, and publish trust pages. Buyers: CTOs, heads of security, compliance managers at 10–500 person SaaS companies selling to enterprise.

**Korrali Revenue** — detects failed payments, revenue leakage, and billing anomalies for Stripe-based SaaS companies. Buyers: founders, CTOs, RevOps at subscription SaaS companies.

Identify top SEO article opportunities. Each topic must:
- Target a real search query someone would type into Google
- Map clearly to one of the two products
- Have commercial or informational search intent worth ranking for

Return a JSON array of topics. Deduplicate aggressively — 6-10 topics maximum.`,
    messages: [{ role: "user", content: userContent }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return [];

  try {
    const text = block.text.trim();
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]") + 1;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd)) as SeoTopic[];
    return parsed.filter((t) => t.product === "TRUST" || t.product === "REVENUE");
  } catch {
    return [];
  }
}
