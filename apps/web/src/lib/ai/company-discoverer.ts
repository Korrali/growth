import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { HIGH_INTENT_MODEL } from "@/lib/ai/models";
import { enqueueFitScore } from "@/lib/queue";
import { normalizeDomain } from "@/lib/import/csv-parser";

// ─── Search provider (Tavily default, Brave fallback) ────────────────────────
// Tavily: free 1,000 searches/month, no card needed — tavily.com/api
// Brave:  $5 free credits/month (~1,000 searches) — api.search.brave.com

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

async function tavilySearch(query: string, maxResults = 10): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      days: 60, // only content published in the last 60 days — ensures each run finds new companies
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.content ?? "",
  }));
}

async function webSearch(query: string, count = 10): Promise<SearchResult[]> {
  // Reddit queries go through Reddit JSON API (free, no key needed) — saves Tavily quota.
  // Reddit 403s datacenter IPs (EC2), so fall through to Tavily on any failure.
  const redditMatch = query.match(/site:reddit\.com\s+r\/(\w+)\s+(.*)/);
  if (redditMatch) {
    try {
      return await redditSearch(redditMatch[1], redditMatch[2], count);
    } catch {
      // fall through to Tavily/Brave below
    }
  }

  // Prefer Tavily (free tier); fall back to Brave if key is present
  if (process.env.TAVILY_API_KEY) return tavilySearch(query, count);

  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) throw new Error("No search API key set — add TAVILY_API_KEY to .env");

  const params = new URLSearchParams({ q: query, count: String(count) });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { "X-Subscription-Token": braveKey, Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brave search error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }));
}

// ─── Reddit JSON API (free, no auth) ─────────────────────────────────────────
// Reddit exposes /r/{sub}/search.json — no key, just a User-Agent header.
// We use this for all site:reddit.com queries so Tavily quota stays for web results.

async function redditSearch(subreddit: string, query: string, limit = 10): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "on",
    sort: "new",
    t: "month",
    limit: String(Math.min(limit, 25)),
    raw_json: "1",
  });
  const url = `https://www.reddit.com/r/${subreddit}/search.json?${params}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "KorraliGrowth/1.0 (company discovery)" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Reddit search error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    data?: {
      children?: Array<{
        data?: { title?: string; url?: string; selftext?: string; permalink?: string };
      }>;
    };
  };

  return (data.data?.children ?? []).map((c) => ({
    title: c.data?.title ?? "",
    url: c.data?.url && !c.data.url.startsWith("/r/")
      ? c.data.url
      : `https://reddit.com${c.data?.permalink ?? ""}`,
    description: (c.data?.selftext ?? "").slice(0, 400),
  }));
}

// ─── Hacker News (Algolia API — free, no auth) ────────────────────────────────
// Pulls "Show HN" posts from the last 14 days. Show HN is a reliable signal:
// founders post their B2B SaaS product here on launch day.

async function hnShowHnCompanies(): Promise<SearchResult[]> {
  const cutoff = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
  const queries = [
    "Show HN B2B SaaS",
    "Show HN enterprise tool",
    "Show HN subscription billing",
    "Show HN compliance security",
  ];

  const results: SearchResult[] = [];
  for (const q of queries) {
    try {
      const url =
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}` +
        `&tags=show_hn&numericFilters=created_at_i>${cutoff}&hitsPerPage=10`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        hits?: Array<{ title?: string; url?: string; story_text?: string; objectID?: string }>;
      };
      for (const h of data.hits ?? []) {
        results.push({
          title: h.title ?? "",
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          description: h.story_text?.slice(0, 400) ?? h.title ?? "",
        });
      }
    } catch {
      // HN API is best-effort
    }
  }
  return results;
}

// ─── ICP search queries ───────────────────────────────────────────────────────
// Two sets of 16. Each run picks one set based on the current week number —
// so consecutive daily runs alternate between sets. With the Tavily `days: 60`
// recency filter, even repeated queries find new companies published since last run.

const QUERY_SET_A = [
  // Trust ICP — enterprise AI/SaaS buyers
  `AI startup enterprise customers "security questionnaire" OR "vendor review" -vanta -drata -secureframe -scrut`,
  `B2B SaaS startup "enterprise deal" OR "enterprise pilot" security compliance`,
  `YC funded AI SaaS company enterprise sales -compliance -soc2`,
  `AI platform startup raised Series A enterprise customers`,
  `"AI-powered" OR "AI-native" B2B SaaS startup enterprise customers product`,
  `site:techcrunch.com AI SaaS startup enterprise raises funding`,
  `site:ycombinator.com company AI SaaS enterprise customers`,
  `B2B AI devtools startup enterprise customers compliance security`,
  // Revenue ICP — Stripe subscription SaaS at scale
  `SaaS startup Series A Stripe billing subscriptions revenue scale`,
  `"failed payments" OR "billing recovery" SaaS startup Stripe subscription`,
  `B2B SaaS "RevOps" OR "revenue operations" Stripe billing engineering team`,
  `site:stripe.com partner OR case-study subscription SaaS startup`,
  `subscription SaaS company "Series A" OR "Series B" payments billing`,
  `site:producthunt.com SaaS subscription billing Stripe payments`,
  `"just closed" OR "raised" B2B SaaS startup enterprise customers Stripe`,
  `site:news.ycombinator.com "Show HN" B2B SaaS enterprise OR Stripe`,
  // Reddit — Trust ICP intent signals (via Tavily, no API key needed)
  `site:reddit.com r/SaaS "security questionnaire" startup`,
  `site:reddit.com r/startups "vendor review" OR "SOC 2" enterprise B2B`,
  // Reddit — Revenue ICP intent signals
  `site:reddit.com r/stripe "failed payments" SaaS subscription`,
  `site:reddit.com r/SaaS "billing" Stripe subscription problem startup`,
  // Revenue ICP — membership/creator businesses on Stripe (segment 2)
  `paid community OR membership site Skool OR Circle OR "Mighty Networks" founder revenue`,
  `course creator Kajabi OR Podia OR Teachable business "failed payments" OR churn`,
  `paid newsletter OR membership business Stripe recurring revenue creator`,
  // BillClear ICP — self-funded employers, benefits brokers, TPAs
  `"self-funded" OR "self-insured" employer health plan benefits costs company`,
  `benefits broker OR "benefits consultant" firm employer health plans clients`,
  `"third-party administrator" OR TPA health benefits employer clients`,
  `site:reddit.com r/humanresources "medical bills" OR "billing errors" employee benefits`,
  // MedScan partnerships — telehealth, pharmacy, senior care
  `telehealth OR "virtual care" startup medication management patients`,
  `"senior care" OR "home care" company medication management caregivers`,
];

const QUERY_SET_B = [
  // Trust ICP — fresh angles on same buyer profile
  `B2B SaaS startup "enterprise customers" "security review" OR "privacy review" raised`,
  `AI startup founders "enterprise sales" "compliance" challenge 2025`,
  `site:techcrunch.com "raises" B2B SaaS startup enterprise 10 50 employees`,
  `"series A" AI startup B2B enterprise SaaS "just launched" OR "just raised"`,
  `site:producthunt.com "enterprise" AI SaaS tool launched`,
  `"we're hiring" B2B AI SaaS startup enterprise customers trust security`,
  `AI agent OR "AI assistant" startup enterprise B2B customers pilot`,
  `B2B SaaS startup "enterprise" "SOC 2" working OR pursuing -vanta -drata`,
  // Revenue ICP — fresh angles
  `subscription SaaS startup "Stripe" billing engineering scale problem`,
  `B2B SaaS "churn" OR "dunning" OR "payment failure" Stripe subscription 2025`,
  `site:news.ycombinator.com Stripe subscription billing SaaS scale`,
  `"series A" OR "series B" SaaS startup subscription billing payments engineering`,
  `B2B SaaS "monthly recurring revenue" Stripe billing problem OR challenge`,
  `startup engineering team "billing infrastructure" OR "payment infrastructure" Stripe`,
  `site:linkedin.com B2B SaaS startup Stripe subscription payments 50 100 employees`,
  `"we use Stripe" B2B SaaS startup subscription revenue scale customers`,
  // Reddit — Trust ICP intent signals (via Tavily, no API key needed)
  `site:reddit.com r/SaaS "enterprise" "compliance" OR "security review" startup`,
  `site:reddit.com r/startups "security questionnaire" OR "trust page" B2B SaaS`,
  // Reddit — Revenue ICP intent signals
  `site:reddit.com r/startups "Stripe" billing subscription issue startup`,
  `site:reddit.com r/entrepreneurship "failed payments" OR "payment recovery" SaaS`,
  // Revenue ICP — membership/creator businesses on Stripe (segment 2, fresh angles)
  `Skool OR Circle community owner "monthly members" revenue business`,
  `membership site OR "online academy" founder Stripe subscriptions growing`,
  `site:reddit.com r/coursecreators "failed payments" OR Stripe OR churn`,
  // BillClear ICP — fresh angles
  `employer "healthcare costs" self-funded plan benefits leader reduce spend`,
  `"level-funded" OR "self-funded" health plan employer 100 1000 employees`,
  `site:reddit.com r/benefits "surprise bill" OR "balance billing" employer plan`,
  `HR tech platform employee benefits marketplace integrations partners`,
  // MedScan partnerships — fresh angles
  `pharmacy chain OR "independent pharmacy" patient app medication adherence`,
  `caregiver platform OR "family caregiving" app medication tracking partnership`,
];

// Pick the query set for this run: alternate daily. Weekly rotation exhausted
// each set (runs kept re-finding the same domains all week: found=187 new=0),
// so daily alternation doubles novelty at the same per-run Tavily cost.
function pickQuerySet(): string[] {
  const dayNumber = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return dayNumber % 2 === 0 ? QUERY_SET_A : QUERY_SET_B;
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

// Deliberately product-agnostic — query sets cover several ICPs (B2B SaaS,
// membership/creator platforms, self-funded employers, telehealth/pharmacy
// partners...) that grows over time. Gating extraction on any one of those
// descriptions would silently drop the others; fit-scorer.ts is where
// per-product ICP matching actually happens, not here.
const EXTRACT_SYSTEM = `You are extracting companies (organizations, businesses) mentioned in web search results.
For each company found in the results, extract their data. Only extract real companies — skip news sites, blogs, agencies, and marketplaces.
Respond with valid JSON only: an object with a "companies" array of company objects.`;

interface ExtractedCompany {
  name: string;
  domain: string;
  website: string;
  description: string;
  industry: string;
  employeeCount: number | null;
}

// Root must be an object — structured outputs rejects/mishandles top-level
// array schemas, which broke every discovery run ("extracted is not iterable").
const EXTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    companies: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          domain: { type: "string", description: "bare domain like acme.com" },
          website: { type: "string", description: "full https URL" },
          description: { type: "string", description: "1-2 sentences from search snippet" },
          industry: { type: "string" },
          employeeCount: { type: ["number", "null"] },
        },
        required: ["name", "domain", "website", "description", "industry", "employeeCount"],
        additionalProperties: false,
      },
    },
  },
  required: ["companies"],
  additionalProperties: false,
};

async function extractCompaniesFromResults(
  results: SearchResult[],
): Promise<ExtractedCompany[]> {
  if (results.length === 0) return [];

  const input = results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.description}`)
    .join("\n\n---\n\n");

  const response = await anthropic.messages.create({
    model: HIGH_INTENT_MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: EXTRACT_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `Extract companies from:\n\n${input}` }],
    output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return [];

  try {
    const parsed = JSON.parse(block.text) as
      | ExtractedCompany[]
      | { companies?: ExtractedCompany[] };
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.companies) ? parsed.companies : [];
  } catch {
    return [];
  }
}

// ─── Main discovery function ──────────────────────────────────────────────────

export async function discoverCompanies(runId: string): Promise<void> {
  const existingDomains = new Set(
    (await prisma.company.findMany({ select: { domain: true } })).map((c) => c.domain),
  );

  let totalQueries = 0;
  let totalFound = 0;
  let totalNew = 0;
  let lastError: string | null = null;

  const queries = pickQuerySet();
  console.log(`[discoverer] run=${runId} using query set ${Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7)) % 2 === 0 ? "A" : "B"}`);

  // ── Hacker News "Show HN" (free, no Tavily budget) ─────────────────────────
  try {
    const hnResults = await hnShowHnCompanies();
    if (hnResults.length > 0) {
      const hnExtracted = await extractCompaniesFromResults(hnResults);
      totalFound += hnExtracted.length;
      for (const company of hnExtracted) {
        const domain = normalizeDomain(company.domain);
        if (!domain || existingDomains.has(domain)) continue;
        if (!domain.includes(".") || domain.length < 4) continue;
        try {
          const created = await prisma.company.create({
            data: {
              name: company.name,
              domain,
              website: company.website || `https://${domain}`,
              description: company.description || null,
              industry: company.industry || null,
              employeeCount: company.employeeCount ?? null,
            },
          });
          existingDomains.add(domain);
          totalNew++;
          await enqueueFitScore({ companyId: created.id });
        } catch { /* duplicate */ }
      }
      console.log(`[discoverer] run=${runId} hn_results=${hnResults.length} hn_extracted=${hnExtracted.length}`);
    }
  } catch (err) {
    console.error(`[discoverer] HN source failed:`, err instanceof Error ? err.message : err);
  }

  // ── Tavily web search queries ────────────────────────────────────────────────
  for (const query of queries) {
    try {
      const results = await webSearch(query, 10);
      totalQueries++;

      const extracted = await extractCompaniesFromResults(results);
      totalFound += extracted.length;

      for (const company of extracted) {
        const domain = normalizeDomain(company.domain);
        if (!domain || existingDomains.has(domain)) continue;

        // Basic sanity: must look like a real domain
        if (!domain.includes(".") || domain.length < 4) continue;

        try {
          const created = await prisma.company.create({
            data: {
              name: company.name,
              domain,
              website: company.website || `https://${domain}`,
              description: company.description || null,
              industry: company.industry || null,
              employeeCount: company.employeeCount ?? null,
            },
          });

          existingDomains.add(domain);
          totalNew++;

          // Kick off fit scoring immediately
          await enqueueFitScore({ companyId: created.id });
        } catch {
          // Duplicate race — another run created this domain, skip silently
        }
      }
    } catch (err) {
      // Truncate — provider error bodies can be full HTML pages (Reddit 403s
      // once stuffed a 180KB page into DiscoveryRun.error).
      lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      console.error(`[discoverer] query failed: "${query}"`, lastError);
    }
  }

  await prisma.discoveryRun.update({
    where: { id: runId },
    data: {
      queriesRun: totalQueries,
      companiesFound: totalFound,
      companiesNew: totalNew,
      error: lastError,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "discovery.completed",
      entity: "DiscoveryRun",
      entityId: runId,
      metadata: { queriesRun: totalQueries, companiesFound: totalFound, companiesNew: totalNew },
    },
  });

  console.log(
    `[discoverer] run=${runId} queries=${totalQueries} found=${totalFound} new=${totalNew}`,
  );
}
