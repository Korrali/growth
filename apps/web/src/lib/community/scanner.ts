import { prisma } from "@/lib/db";
import { scoreCommunityMention } from "@/lib/ai/community-intent-scorer";
import { CommunitySource } from "@prisma/client";

// ─── Scan targets ────────────────────────────────────────────────────────────
// Reddit: Tavily site: queries (10 targets, 3×/week)
// HN:     Algolia API — free, no key, no rate limit
// IH:     Tavily site: queries (4 targets, 3×/week)
// Tavily: 14 targets × 3 runs/week ≈ 180 calls/month, shared with on-demand
//         company discovery + contact import (free tier = 1,000/month).

interface ScanTarget {
  source: CommunitySource;
  subreddit?: string;
  keyword: string;
}

const SCAN_TARGETS: ScanTarget[] = [
  // ── Reddit — Trust ICP ────────────────────────────────────────────────────
  { source: "REDDIT", subreddit: "SaaS",     keyword: `site:reddit.com/r/SaaS "security questionnaire"` },
  { source: "REDDIT", subreddit: "SaaS",     keyword: `site:reddit.com/r/SaaS "SOC 2" startup` },
  { source: "REDDIT", subreddit: "startups", keyword: `site:reddit.com/r/startups "compliance" enterprise B2B` },
  { source: "REDDIT", subreddit: "startups", keyword: `site:reddit.com/r/startups "security review" SaaS` },
  // ── Reddit — Revenue ICP ──────────────────────────────────────────────────
  { source: "REDDIT", subreddit: "stripe",   keyword: `site:reddit.com/r/stripe "failed payments" SaaS` },
  { source: "REDDIT", subreddit: "SaaS",     keyword: `site:reddit.com/r/SaaS "Stripe" billing subscription problem` },
  { source: "REDDIT", subreddit: "startups", keyword: `site:reddit.com/r/startups "failed payments" subscription startup` },
  { source: "REDDIT", subreddit: "EntrepreneurRideAlong", keyword: `site:reddit.com/r/EntrepreneurRideAlong "billing" Stripe subscription` },
  { source: "REDDIT", subreddit: "SaaS",     keyword: `site:reddit.com/r/SaaS "vendor review" enterprise` },
  { source: "REDDIT", subreddit: "stripe",   keyword: `site:reddit.com/r/stripe "billing issue" subscription` },
  // ── Indie Hackers — Trust ICP ─────────────────────────────────────────────
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "compliance" SaaS enterprise` },
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "security questionnaire" OR "SOC 2" startup` },
  // ── Indie Hackers — Revenue ICP ───────────────────────────────────────────
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "failed payments" OR "billing" subscription Stripe` },
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "churn" OR "dunning" SaaS Stripe` },
];

// HN Algolia queries — free API, not in SCAN_TARGETS
const HN_QUERIES = [
  "AI compliance SOC2 startup",
  "security questionnaire vendor review SaaS",
  "AI governance enterprise compliance",
  "failed payments billing Stripe SaaS",
  "trust center compliance automation",
  "stripe billing subscription dunning",
];

// ─── Tavily helper ────────────────────────────────────────────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      days: 14,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
}

// ─── Reddit helpers ───────────────────────────────────────────────────────────

function extractRedditPostId(url: string): string | null {
  const match = url.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i);
  return match ? match[1] : null;
}

function extractAuthor(content: string): string {
  const match = content.match(/u\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : "unknown";
}

// ─── HN Algolia scanner ───────────────────────────────────────────────────────

interface HnHit {
  objectID: string;
  title?: string;
  url?: string;
  story_text?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
}

async function scanHackerNews(query: string): Promise<HnHit[]> {
  const cutoff = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
    `&tags=comment,story&numericFilters=created_at_i>${cutoff}&hitsPerPage=10`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as { hits?: HnHit[] };
  return data.hits ?? [];
}

// ─── Process a single Tavily result into CommunityMention ────────────────────

async function processTavilyResult(
  result: TavilyResult,
  source: CommunitySource,
  subreddit: string | undefined,
  keyword: string,
): Promise<"new" | "exists" | "skip"> {
  let externalId: string;
  let url = result.url;

  if (source === "REDDIT") {
    const id = extractRedditPostId(url);
    if (!id) return "skip";
    externalId = id;
  } else {
    // For IH: use URL as stable ID (slugified)
    externalId = url.replace(/[^a-z0-9]/gi, "_").slice(0, 120);
  }

  const exists = await prisma.communityMention.findUnique({
    where: { source_externalId: { source, externalId } },
    select: { id: true },
  });
  if (exists) return "exists";

  const author = source === "REDDIT" ? extractAuthor(result.content) : "unknown";

  let mention;
  try {
    mention = await prisma.communityMention.create({
      data: {
        source,
        externalId,
        subreddit: subreddit ?? null,
        title: result.title,
        body: result.content,
        url,
        author,
        createdUtc: 0,
        status: "unscored",
      },
    });
  } catch {
    return "exists"; // duplicate race
  }

  try {
    await scoreCommunityMention(mention.id);
  } catch (err) {
    console.error(`[community-scanner] scoring failed for ${externalId}:`, err instanceof Error ? err.message : err);
  }

  return "new";
}

// ─── Tavily scan (Reddit + IH) ────────────────────────────────────────────────

async function runTavilyScan(): Promise<void> {
  if (!process.env.TAVILY_API_KEY) {
    console.log("[community-scanner] skipping Tavily — TAVILY_API_KEY not set");
    return;
  }

  // Collect queries that *just* crossed the failure threshold this run, so we
  // send a single consolidated alert instead of one email per failing query.
  const newlyBroken: { source: CommunitySource; keyword: string; error: string }[] = [];

  for (const target of SCAN_TARGETS) {
    const { source, subreddit, keyword } = target;
    const startedAt = Date.now();
    let postsFound = 0;
    let newPosts = 0;
    let errorMsg: string | null = null;

    try {
      const results = await tavilySearch(keyword);
      const validResults = source === "REDDIT"
        ? results.filter((r) => extractRedditPostId(r.url))
        : results.filter((r) => r.url.includes("indiehackers.com"));

      postsFound = validResults.length;

      for (const result of validResults) {
        const outcome = await processTavilyResult(result, source, subreddit, keyword);
        if (outcome === "new") newPosts++;
      }

      await prisma.communityScanState.upsert({
        where: { source_keyword: { source, keyword } },
        create: { source, keyword, consecutiveErrors: 0 },
        update: { lastScannedAt: new Date(), consecutiveErrors: 0 },
      });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[community-scanner] error on "${keyword}":`, errorMsg);

      const updated = await prisma.communityScanState.upsert({
        where: { source_keyword: { source, keyword } },
        create: { source, keyword, consecutiveErrors: 1 },
        update: { consecutiveErrors: { increment: 1 }, lastScannedAt: new Date() },
      });

      // Alert only on the exact run a query crosses the threshold — never again
      // while it stays broken — so a quota outage can't spam one email per day.
      if (updated.consecutiveErrors === 3) {
        newlyBroken.push({ source, keyword, error: errorMsg });
      }
    }

    await prisma.communityScanLog.create({
      data: { source, keyword, postsFound, newPosts, error: errorMsg, durationMs: Date.now() - startedAt },
    });

    console.log(`[community-scanner] ${source} found=${postsFound} new=${newPosts}${errorMsg ? ` err=${errorMsg}` : ""}`);
  }

  // One email per run, listing every query that just broke. A shared-quota
  // outage hits many queries at once but now produces a single alert.
  if (newlyBroken.length > 0) {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const lines = newlyBroken
        .map((b) => `• [${b.source}] ${b.keyword}\n  ${b.error}`)
        .join("\n\n");
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "growth@korrali.com",
          to: "bhagat.ashish.a@gmail.com",
          subject: `[Community Scout] ${newlyBroken.length} quer${newlyBroken.length === 1 ? "y" : "ies"} hit 3 consecutive failures`,
          text: `These queries just failed 3 times in a row (you will not be alerted again until they recover and re-break):\n\n${lines}`,
        }),
      }).catch(() => {});
    }
  }
}

// ─── HN Algolia scan (free) ───────────────────────────────────────────────────

async function runHnScan(): Promise<void> {
  for (const query of HN_QUERIES) {
    const startedAt = Date.now();
    let postsFound = 0;
    let newPosts = 0;
    let errorMsg: string | null = null;

    try {
      const hits = await scanHackerNews(query);
      postsFound = hits.length;

      for (const hit of hits) {
        const externalId = hit.objectID;
        const exists = await prisma.communityMention.findUnique({
          where: { source_externalId: { source: "HACKERNEWS", externalId } },
          select: { id: true },
        });
        if (exists) continue;

        let mention;
        try {
          mention = await prisma.communityMention.create({
            data: {
              source: "HACKERNEWS",
              externalId,
              title: hit.title ?? query,
              body: hit.story_text?.slice(0, 1000) ?? null,
              url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
              author: hit.author ?? "unknown",
              score: hit.points ?? 0,
              numComments: hit.num_comments ?? 0,
              createdUtc: hit.created_at_i ?? 0,
              status: "unscored",
            },
          });
        } catch {
          continue; // duplicate race
        }

        try {
          await scoreCommunityMention(mention.id);
          newPosts++;
        } catch (err) {
          console.error(`[community-scanner] HN scoring failed for ${externalId}:`, err instanceof Error ? err.message : err);
        }
      }

      await prisma.communityScanState.upsert({
        where: { source_keyword: { source: "HACKERNEWS", keyword: query } },
        create: { source: "HACKERNEWS", keyword: query, consecutiveErrors: 0 },
        update: { lastScannedAt: new Date(), consecutiveErrors: 0 },
      });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[community-scanner] HN error on "${query}":`, errorMsg);
    }

    await prisma.communityScanLog.create({
      data: { source: "HACKERNEWS", keyword: query, postsFound, newPosts, error: errorMsg, durationMs: Date.now() - startedAt },
    });

    console.log(`[community-scanner] HN "${query}" found=${postsFound} new=${newPosts}`);
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runCommunityScan(): Promise<void> {
  console.log("[community-scanner] starting");
  await Promise.allSettled([
    runTavilyScan(),
    runHnScan(),
  ]);
  console.log("[community-scanner] complete");
}
