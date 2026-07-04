import { prisma } from "@/lib/db";
import { scoreCommunityMention } from "@/lib/ai/community-intent-scorer";
import { CommunitySource } from "@prisma/client";

// ─── Scan targets ────────────────────────────────────────────────────────────
// Reddit: native Reddit JSON API — free, no key, 10 req/min unauthenticated.
// HN:     Algolia API — free, no key, no rate limit.
// IH:     Tavily site: queries — only 4 targets × 3 runs/week ≈ 48 calls/month,
//         keeping Tavily well within the free 1,000/month shared with company
//         discovery and contact-finder.

interface RedditTarget {
  subreddit: string;
  keyword: string; // search terms sent to Reddit's own search API
}

// Subreddit-scoped searches using Reddit's native /r/{sub}/search.json endpoint.
const REDDIT_TARGETS: RedditTarget[] = [
  // Trust ICP
  { subreddit: "SaaS",                    keyword: '"security questionnaire"' },
  { subreddit: "SaaS",                    keyword: '"SOC 2" startup' },
  { subreddit: "startups",               keyword: '"compliance" enterprise B2B' },
  { subreddit: "startups",               keyword: '"security review" SaaS' },
  // Revenue ICP
  { subreddit: "stripe",                 keyword: '"failed payments" SaaS' },
  { subreddit: "SaaS",                   keyword: '"Stripe" billing subscription problem' },
  { subreddit: "startups",               keyword: '"failed payments" subscription startup' },
  { subreddit: "EntrepreneurRideAlong",  keyword: '"billing" Stripe subscription' },
  { subreddit: "SaaS",                   keyword: '"vendor review" enterprise' },
  { subreddit: "stripe",                 keyword: '"billing issue" subscription' },
];

interface TavilyTarget {
  source: CommunitySource;
  keyword: string; // Tavily site: query
}

// IH only — 4 targets keeps Tavily quota free for company discovery / contact import.
const TAVILY_TARGETS: TavilyTarget[] = [
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "compliance" SaaS enterprise` },
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "security questionnaire" OR "SOC 2" startup` },
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "failed payments" OR "billing" subscription Stripe` },
  { source: "INDIE_HACKERS", keyword: `site:indiehackers.com "churn" OR "dunning" SaaS Stripe` },
];

// HN Algolia queries — free API, no key needed
const HN_QUERIES = [
  "AI compliance SOC2 startup",
  "security questionnaire vendor review SaaS",
  "AI governance enterprise compliance",
  "failed payments billing Stripe SaaS",
  "trust center compliance automation",
  "stripe billing subscription dunning",
];

// ─── Reddit native API ────────────────────────────────────────────────────────
// Free, no key required. Rate limit: 10 req/min unauthenticated — well within
// our 3×/week schedule (10 subreddit searches per run).

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  author: string;
}

async function redditSearch(subreddit: string, query: string): Promise<RedditPost[]> {
  const url =
    `https://www.reddit.com/r/${subreddit}/search.json` +
    `?q=${encodeURIComponent(query)}&restrict_sr=on&sort=new&t=month&limit=10`;

  const res = await fetch(url, {
    headers: { "User-Agent": "korrali-growth-scanner/1.0" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Reddit API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    data?: { children?: Array<{ data?: RedditPost }> };
  };

  return (data.data?.children ?? [])
    .map((c) => c.data)
    .filter((p): p is RedditPost => Boolean(p?.id));
}

// ─── Tavily helper (IH only) ──────────────────────────────────────────────────

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

// ─── Process a single Tavily (IH) result into CommunityMention ───────────────

async function processTavilyResult(
  result: TavilyResult,
  source: CommunitySource,
): Promise<"new" | "exists"> {
  const externalId = result.url.replace(/[^a-z0-9]/gi, "_").slice(0, 120);

  const exists = await prisma.communityMention.findUnique({
    where: { source_externalId: { source, externalId } },
    select: { id: true },
  });
  if (exists) return "exists";

  let mention;
  try {
    mention = await prisma.communityMention.create({
      data: {
        source,
        externalId,
        subreddit: null,
        title: result.title,
        body: result.content,
        url: result.url,
        author: "unknown",
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

// ─── Reddit native scan (free) ────────────────────────────────────────────────

async function sendAlert(subject: string, body: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "growth@korrali.com",
      to: "bhagat.ashish.a@gmail.com",
      subject,
      text: body,
    }),
  }).catch(() => {});
}

async function runRedditNativeScan(): Promise<void> {
  const newlyBroken: { subreddit: string; keyword: string; error: string }[] = [];

  for (const { subreddit, keyword } of REDDIT_TARGETS) {
    const scanKey = `${subreddit}:${keyword}`;
    const startedAt = Date.now();
    let postsFound = 0;
    let newPosts = 0;
    let errorMsg: string | null = null;

    try {
      const posts = await redditSearch(subreddit, keyword);
      postsFound = posts.length;

      for (const post of posts) {
        const externalId = post.id;
        const exists = await prisma.communityMention.findUnique({
          where: { source_externalId: { source: "REDDIT", externalId } },
          select: { id: true },
        });
        if (exists) continue;

        let mention;
        try {
          mention = await prisma.communityMention.create({
            data: {
              source: "REDDIT",
              externalId,
              subreddit,
              title: post.title,
              body: post.selftext?.slice(0, 2000) ?? null,
              url: `https://www.reddit.com${post.permalink}`,
              author: post.author ?? "unknown",
              createdUtc: 0,
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
          console.error(`[community-scanner] Reddit scoring failed for ${externalId}:`, err instanceof Error ? err.message : err);
        }
      }

      await prisma.communityScanState.upsert({
        where: { source_keyword: { source: "REDDIT", keyword: scanKey } },
        create: { source: "REDDIT", keyword: scanKey, consecutiveErrors: 0 },
        update: { lastScannedAt: new Date(), consecutiveErrors: 0 },
      });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[community-scanner] Reddit r/${subreddit} "${keyword}":`, errorMsg);

      const updated = await prisma.communityScanState.upsert({
        where: { source_keyword: { source: "REDDIT", keyword: scanKey } },
        create: { source: "REDDIT", keyword: scanKey, consecutiveErrors: 1 },
        update: { consecutiveErrors: { increment: 1 }, lastScannedAt: new Date() },
      });

      if (updated.consecutiveErrors === 3) {
        newlyBroken.push({ subreddit, keyword, error: errorMsg });
      }
    }

    await prisma.communityScanLog.create({
      data: { source: "REDDIT", keyword: scanKey, postsFound, newPosts, error: errorMsg, durationMs: Date.now() - startedAt },
    });

    console.log(`[community-scanner] Reddit r/${subreddit} found=${postsFound} new=${newPosts}${errorMsg ? ` err=${errorMsg}` : ""}`);
  }

  if (newlyBroken.length > 0) {
    const lines = newlyBroken.map((b) => `• r/${b.subreddit} "${b.keyword}"\n  ${b.error}`).join("\n\n");
    await sendAlert(
      `[Community Scout] ${newlyBroken.length} Reddit target${newlyBroken.length === 1 ? "" : "s"} hit 3 consecutive failures`,
      `These Reddit queries just failed 3 times in a row (no further alert until they recover and re-break):\n\n${lines}`,
    );
  }
}

// ─── Tavily scan (IH only) ────────────────────────────────────────────────────

async function runTavilyScan(): Promise<void> {
  if (!process.env.TAVILY_API_KEY) {
    console.log("[community-scanner] skipping Tavily — TAVILY_API_KEY not set");
    return;
  }

  const newlyBroken: { source: CommunitySource; keyword: string; error: string }[] = [];

  for (const { source, keyword } of TAVILY_TARGETS) {
    const startedAt = Date.now();
    let postsFound = 0;
    let newPosts = 0;
    let errorMsg: string | null = null;

    try {
      const results = (await tavilySearch(keyword)).filter((r) => r.url.includes("indiehackers.com"));
      postsFound = results.length;

      for (const result of results) {
        const outcome = await processTavilyResult(result, source);
        if (outcome === "new") newPosts++;
      }

      await prisma.communityScanState.upsert({
        where: { source_keyword: { source, keyword } },
        create: { source, keyword, consecutiveErrors: 0 },
        update: { lastScannedAt: new Date(), consecutiveErrors: 0 },
      });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[community-scanner] Tavily error on "${keyword}":`, errorMsg);

      const updated = await prisma.communityScanState.upsert({
        where: { source_keyword: { source, keyword } },
        create: { source, keyword, consecutiveErrors: 1 },
        update: { consecutiveErrors: { increment: 1 }, lastScannedAt: new Date() },
      });

      if (updated.consecutiveErrors === 3) {
        newlyBroken.push({ source, keyword, error: errorMsg });
      }
    }

    await prisma.communityScanLog.create({
      data: { source, keyword, postsFound, newPosts, error: errorMsg, durationMs: Date.now() - startedAt },
    });

    console.log(`[community-scanner] ${source} found=${postsFound} new=${newPosts}${errorMsg ? ` err=${errorMsg}` : ""}`);
  }

  if (newlyBroken.length > 0) {
    const lines = newlyBroken.map((b) => `• [${b.source}] ${b.keyword}\n  ${b.error}`).join("\n\n");
    await sendAlert(
      `[Community Scout] ${newlyBroken.length} Tavily quer${newlyBroken.length === 1 ? "y" : "ies"} hit 3 consecutive failures`,
      `These queries just failed 3 times in a row (no further alert until they recover and re-break):\n\n${lines}`,
    );
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
    runRedditNativeScan(),
    runTavilyScan(),
    runHnScan(),
  ]);
  console.log("[community-scanner] complete");
}
