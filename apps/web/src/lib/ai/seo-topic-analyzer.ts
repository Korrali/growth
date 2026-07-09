import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { MARKETED_PRODUCT_KEYS, PRODUCTS, type MarketedProduct } from "@/lib/products";

export interface SeoTopic {
  topic: string;
  targetKeyword: string;
  suggestedTitle: string;
  metaDescription: string;
  searchIntent: string;         // what the searcher is trying to do
  product: MarketedProduct;
  sourceCount: number;          // how many community mentions back this topic
  sourceSample: string[];       // up to 3 post titles that triggered it
}

const PRODUCT_KEY_LIST = MARKETED_PRODUCT_KEYS.join(" | ");

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
    ? `Here are ${mentions.length} community posts from people expressing pain. Extract the top SEO article opportunities:\n\n${mentionSummary}\n\nReturn JSON array with this shape for each topic:\n{\n  "topic": "brief topic name",\n  "targetKeyword": "exact keyword phrase to rank for",\n  "suggestedTitle": "SEO article title (50-60 chars)",\n  "metaDescription": "meta description (150-160 chars)",\n  "searchIntent": "what the searcher wants",\n  "product": "${PRODUCT_KEY_LIST}",\n  "sourceCount": number of posts backing this,\n  "sourceSample": ["post title 1", "post title 2"]\n}`
    : `No community data is available yet. Generate 12 high-value SEO article topics based purely on your product knowledge of the products and common search patterns in their spaces (B2B SaaS compliance, billing/payments, employee benefits & medical bills, and consumer medication safety). Cover every product with at least 2 topics.\n\nReturn JSON array with this shape for each topic:\n{\n  "topic": "brief topic name",\n  "targetKeyword": "exact keyword phrase to rank for",\n  "suggestedTitle": "SEO article title (50-60 chars)",\n  "metaDescription": "meta description (150-160 chars)",\n  "searchIntent": "what the searcher wants",\n  "product": "${PRODUCT_KEY_LIST}",\n  "sourceCount": 0,\n  "sourceSample": []\n}`;

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    // 8-14 topics × 7 fields (incl. a 150-160 char meta description) overruns
    // 2048 tokens and truncates the JSON array → parse fails → silent []. Give
    // it real headroom.
    max_tokens: 4096,
    system: `You are an SEO strategist for ${MARKETED_PRODUCT_KEYS.length} products:

${MARKETED_PRODUCT_KEYS.map((k) => `**${PRODUCTS[k].name}** (${k}) — ${PRODUCTS[k].oneLiner} Buyers: ${PRODUCTS[k].buyers}`).join("\n\n")}

Identify top SEO article opportunities. Each topic must:
- Target a real search query someone would type into Google
- Map clearly to one of the products (use its key)
- Have commercial or informational search intent worth ranking for
- Match the product's audience: B2B buyer queries for TRUST/REVENUE/BILLCLEAR, consumer health queries for MEDSCAN

Return a JSON array of topics. Deduplicate aggressively — 8-14 topics maximum.`,
    messages: [{ role: "user", content: userContent }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopReason = (response as any).stop_reason;
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    console.warn(`[seo-topics] no text block in AI response (stop_reason=${stopReason}) — returning 0 topics`);
    return [];
  }

  const text = block.text.trim();
  try {
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]") + 1;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd)) as SeoTopic[];
    const kept = parsed.filter((t) => MARKETED_PRODUCT_KEYS.includes(t.product));
    // Never fail silently again — a 0-topic result is why the content pipeline
    // sat dead and invisible for days (2026-07-09).
    if (kept.length === 0) {
      console.warn(
        `[seo-topics] parsed ${parsed.length} topics but 0 matched product keys (${PRODUCT_KEY_LIST}); first product seen=${JSON.stringify(parsed[0]?.product)}`,
      );
    }
    return kept;
  } catch (err) {
    console.warn(
      `[seo-topics] JSON parse failed (stop_reason=${stopReason}, text_len=${text.length}): ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
}
