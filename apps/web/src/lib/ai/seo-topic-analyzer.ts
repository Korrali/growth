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
  /**
   * Catalog topics only: the real page on the product site this article should
   * point at (e.g. "/tools/ofx-to-csv"). Always a path fetched live from the
   * product's own sitemap — never model-invented.
   */
  landingPath?: string;
}

const COMMUNITY_PRODUCT_KEYS = MARKETED_PRODUCT_KEYS.filter(
  (k) => PRODUCTS[k].topicSourcing === "community",
);
const CATALOG_PRODUCT_KEYS = MARKETED_PRODUCT_KEYS.filter(
  (k) => PRODUCTS[k].topicSourcing === "catalog",
);

const COMMUNITY_KEY_LIST = COMMUNITY_PRODUCT_KEYS.join(" | ");

// ─── Catalog surfaces (real pages, fetched live) ──────────────────────────────

/**
 * Fetch the product's live sitemap and return the tool/check pages it actually
 * serves. Ground truth deliberately comes from the running site rather than a
 * list hardcoded here — this file would otherwise drift the moment a tool is
 * added or removed, and an article promoting a 404 is worse than no article.
 */
async function fetchCatalogSurfaces(product: MarketedProduct): Promise<string[]> {
  const ctx = PRODUCTS[product];
  const prefixes = ctx.catalogSurfacePrefixes ?? [];
  if (prefixes.length === 0) return [];

  const res = await fetch(`${ctx.url}/sitemap.xml`, {
    headers: { "User-Agent": "korrali-growth/seo-topics" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`sitemap ${res.status}`);

  const xml = await res.text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .map((loc) => {
      try {
        return new URL(loc).pathname;
      } catch {
        return null;
      }
    })
    .filter((p): p is string => p !== null)
    .filter((p) => prefixes.some((prefix) => p.startsWith(prefix)));

  return [...new Set(paths)];
}

/**
 * Generate topics for a self-serve product from its own tool catalog.
 *
 * Each topic is pinned to one real page. These products' searchers don't post
 * in the forums we scan — they type the problem into Google — so community
 * mining structurally returns nothing for them.
 */
async function analyzeCatalogTopics(product: MarketedProduct): Promise<SeoTopic[]> {
  const ctx = PRODUCTS[product];

  let surfaces: string[];
  try {
    surfaces = await fetchCatalogSurfaces(product);
  } catch (err) {
    console.warn(
      `[seo-topics] ${product}: could not fetch catalog surfaces (${err instanceof Error ? err.message : err}) — skipping, no topics invented`,
    );
    return [];
  }

  if (surfaces.length === 0) {
    console.warn(`[seo-topics] ${product}: sitemap returned 0 matching tool pages — skipping`);
    return [];
  }

  // Optional phrasing signal: posts scraped from the subreddits scanned on this
  // product's behalf. Purely to borrow how people actually word the problem —
  // topic selection is still anchored to the real page list, so an empty result
  // here costs nothing.
  const { subredditsForProduct } = await import("@/lib/community/scanner");
  const subreddits = subredditsForProduct(product);
  const mentions = subreddits.length
    ? await prisma.communityMention.findMany({
        where: { subreddit: { in: subreddits }, intentScore: { gte: 4 } },
        orderBy: { intentScore: "desc" },
        take: 40,
        select: { title: true, subreddit: true },
      })
    : [];

  const phrasingHint = mentions.length
    ? `\n\nFor reference, real posts from people with these problems — mirror their vocabulary where it fits, but do not let these override the page list:\n${mentions.map((m) => `- [r/${m.subreddit}] ${m.title}`).join("\n")}`
    : "";

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    max_tokens: 4096,
    system: `You are an SEO strategist for **${ctx.name}** — ${ctx.oneLiner}

Audience: ${ctx.buyers}

Topic guidance for this product:
${ctx.icp}

You will be given the EXACT list of tool pages this product actually serves. Produce long-tail article topics that each map to ONE of those pages.

Hard rules:
- "landingPath" MUST be copied verbatim from the provided list. Never invent a path, never modify one.
- Every topic must describe a problem the linked tool genuinely solves. If a topic would require a capability not represented in the list, drop it.
- Target how a real person phrases the problem in Google ("quickbooks won't import my csv"), not category terms ("best csv software").
- Prefer specific, low-competition, high-intent queries over broad head terms.
- One topic per page at most. Deduplicate aggressively.`,
    messages: [
      {
        role: "user",
        content: `These are the ${surfaces.length} tool pages ${ctx.name} actually serves:

${surfaces.map((p) => `- ${p}`).join("\n")}

Pick the ${Math.min(8, surfaces.length)} highest-opportunity pages and write one article topic for each.

Return a JSON array only, each item shaped:
{
  "topic": "brief topic name",
  "targetKeyword": "exact keyword phrase to rank for",
  "suggestedTitle": "SEO article title (50-60 chars)",
  "metaDescription": "meta description (150-160 chars)",
  "searchIntent": "what the searcher wants",
  "landingPath": "one path copied exactly from the list above"
}${phrasingHint}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    console.warn(`[seo-topics] ${product}: no text block in catalog response`);
    return [];
  }

  const text = block.text.trim();
  try {
    const parsed = JSON.parse(
      text.slice(text.indexOf("["), text.lastIndexOf("]") + 1),
    ) as Array<Omit<SeoTopic, "product" | "sourceCount" | "sourceSample">>;

    // Enforce the "real page" contract in code, not just in the prompt.
    const valid = surfaces;
    const kept = parsed
      .filter((t) => {
        if (t.landingPath && valid.includes(t.landingPath)) return true;
        console.warn(
          `[seo-topics] ${product}: dropped "${t.suggestedTitle}" — landingPath ${JSON.stringify(t.landingPath)} is not a real page`,
        );
        return false;
      })
      .map((t) => ({ ...t, product, sourceCount: 0, sourceSample: [] }));

    console.log(`[seo-topics] ${product}: ${kept.length} catalog topics from ${surfaces.length} pages`);
    return kept;
  } catch (err) {
    console.warn(
      `[seo-topics] ${product}: catalog JSON parse failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
}

// ─── Community-sourced topics ─────────────────────────────────────────────────

async function analyzeCommunityTopics(): Promise<SeoTopic[]> {
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
    ? `Here are ${mentions.length} community posts from people expressing pain. Extract the top SEO article opportunities:\n\n${mentionSummary}\n\nReturn JSON array with this shape for each topic:\n{\n  "topic": "brief topic name",\n  "targetKeyword": "exact keyword phrase to rank for",\n  "suggestedTitle": "SEO article title (50-60 chars)",\n  "metaDescription": "meta description (150-160 chars)",\n  "searchIntent": "what the searcher wants",\n  "product": "${COMMUNITY_KEY_LIST}",\n  "sourceCount": number of posts backing this,\n  "sourceSample": ["post title 1", "post title 2"]\n}`
    : `No community data is available yet. Generate 12 high-value SEO article topics based purely on your product knowledge of the products and common search patterns in their spaces (B2B SaaS compliance, billing/payments, employee benefits & medical bills, and consumer medication safety). Cover every product with at least 2 topics.\n\nReturn JSON array with this shape for each topic:\n{\n  "topic": "brief topic name",\n  "targetKeyword": "exact keyword phrase to rank for",\n  "suggestedTitle": "SEO article title (50-60 chars)",\n  "metaDescription": "meta description (150-160 chars)",\n  "searchIntent": "what the searcher wants",\n  "product": "${COMMUNITY_KEY_LIST}",\n  "sourceCount": 0,\n  "sourceSample": []\n}`;

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    // 8-14 topics × 7 fields (incl. a 150-160 char meta description) overruns
    // 2048 tokens and truncates the JSON array → parse fails → silent []. Give
    // it real headroom.
    max_tokens: 4096,
    system: `You are an SEO strategist for ${COMMUNITY_PRODUCT_KEYS.length} products:

${COMMUNITY_PRODUCT_KEYS.map((k) => `**${PRODUCTS[k].name}** (${k}) — ${PRODUCTS[k].oneLiner} Buyers: ${PRODUCTS[k].buyers}`).join("\n\n")}

Identify top SEO article opportunities. Each topic must:
- Target a real search query someone would type into Google
- Map clearly to one of the products listed above (use its key)
- Have commercial or informational search intent worth ranking for
- Match the product's audience: B2B buyer queries for TRUST/REVENUE/BILLCLEAR, consumer health queries for MEDSCAN

Only use the product keys listed above. Other Korrali products get their topics from a separate catalog-driven process — do not emit topics for them here.

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
    const kept = parsed.filter((t) => COMMUNITY_PRODUCT_KEYS.includes(t.product));
    // Never fail silently again — a 0-topic result is why the content pipeline
    // sat dead and invisible for days (2026-07-09).
    if (kept.length === 0) {
      console.warn(
        `[seo-topics] parsed ${parsed.length} topics but 0 matched product keys (${COMMUNITY_KEY_LIST}); first product seen=${JSON.stringify(parsed[0]?.product)}`,
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

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Full topic set across every marketed product.
 *
 * Two independent branches so one can't starve the other: community mining for
 * products with a forum constituency, catalog generation for the self-serve
 * ones. Before this split, community mentions (all Trust/Revenue pain) were the
 * only input, so Data and Web sat at zero published articles.
 */
export async function analyzeSeoTopics(): Promise<SeoTopic[]> {
  const [community, ...catalogs] = await Promise.all([
    analyzeCommunityTopics().catch((err) => {
      console.error("[seo-topics] community branch failed:", err instanceof Error ? err.message : err);
      return [] as SeoTopic[];
    }),
    ...CATALOG_PRODUCT_KEYS.map((k) =>
      analyzeCatalogTopics(k).catch((err) => {
        console.error(`[seo-topics] catalog branch ${k} failed:`, err instanceof Error ? err.message : err);
        return [] as SeoTopic[];
      }),
    ),
  ]);

  const all = [...community, ...catalogs.flat()];
  const byProduct = all.reduce<Record<string, number>>((acc, t) => {
    acc[t.product] = (acc[t.product] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[seo-topics] ${all.length} topics total: ${JSON.stringify(byProduct)}`);
  return all;
}
