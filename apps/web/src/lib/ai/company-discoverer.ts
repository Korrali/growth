import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { enqueueFitScore } from "@/lib/queue";
import { normalizeDomain } from "@/lib/import/csv-parser";
import { searchSubreddit } from "@/lib/reddit/client";

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
      // Without page content, extraction only sees title + ~300-char snippet
      // and can only extract companies literally named there — i.e. the same
      // famous names in every article (the found=311/new=0 saturation of
      // 2026-06-18 → 2026-07-07). Raw content lets it find the long-tail
      // companies the posts are actually about.
      include_raw_content: true,
      days: 60, // only content published in the last 60 days — ensures each run finds new companies
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string | null }>;
  };

  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    // Prefer full page text (capped — extraction batches 10 results per AI
    // call and HIGH_INTENT_MODEL context is finite); fall back to snippet.
    description: r.raw_content ? r.raw_content.slice(0, 2500) : (r.content ?? ""),
  }));
}

async function webSearch(query: string, count = 10): Promise<SearchResult[]> {
  // Reddit queries go through the OAuth-authenticated Reddit client (saves Tavily
  // quota). Reddit's anti-bot layer blocks unauthenticated requests from datacenter
  // IPs (EC2) with a challenge page instead of JSON — OAuth avoids that. Still fall
  // through to Tavily on any failure (rate limit, missing credentials, etc).
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

// ─── Reddit search (OAuth via lib/reddit/client) ──────────────────────────────
// We use this for all site:reddit.com queries so Tavily quota stays for web results.
// t=month (vs the client's t=week default) to match this feature's original
// recency window.

async function redditSearch(subreddit: string, query: string, limit = 10): Promise<SearchResult[]> {
  const { posts } = await searchSubreddit(subreddit, query, null, Math.min(limit, 25), "month");

  return posts.map((p) => ({
    title: p.title,
    url: p.url && !p.url.startsWith("/r/") ? p.url : `https://reddit.com${p.permalink ?? ""}`,
    description: (p.selftext ?? "").slice(0, 400),
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
// Two sets, one per product's ICP angles (grown past the original 16 as more
// segments were added). Each run picks one set based on the current day —
// so consecutive daily runs alternate between sets. With the Tavily `days: 60`
// recency filter, even repeated queries find new companies published since last run.

// ─── Budget allocation between products ──────────────────────────────────────
// Discovery runs WEEKLY (Mon 5am UTC) on the free Tavily plan — roughly 35
// credits a run, kept under 200/mo including community scans. Every query in
// the chosen set runs, so set size IS the budget: a Trust query costs a Revenue
// query.
//
// REPOINTED 2026-07-31 to Revenue-heavy. The split had been ~50/50, but the
// two products are in completely different supply positions:
//   Trust:   54 companies already enrollable (fitScore >= 6), 35 with contacts
//   Revenue:  6 companies enrollable, 5 with contacts, best score 7
// Trust cannot work through the backlog it already has at 30 sends/day, so
// every Trust query buys inventory that will never be used, while Revenue —
// the single bet to Jan 2027 — starves. Trust queries are kept (not deleted)
// at TRUST_QUERY_LIMIT so the decision is one number to reverse, not a rewrite.
const TRUST_QUERY_LIMIT = 6;

// Trust queries, best-first — only the first TRUST_QUERY_LIMIT actually run.
const TRUST_QUERIES_A = [
  `AI startup enterprise customers "security questionnaire" OR "vendor review" -vanta -drata -secureframe -scrut`,
  `"EU AI Act" compliance startup enterprise customers vendor -vanta -drata`,
  `"AI agent" OR LLM startup enterprise "security questionnaire" OR procurement`,
  `B2B SaaS startup "enterprise deal" OR "enterprise pilot" security compliance`,
  `"ISO 42001" OR "AI governance" B2B startup enterprise customers`,
  `site:news.ycombinator.com "Launch HN" AI B2B enterprise`,
  `site:reddit.com r/SaaS "security questionnaire" startup`,
  `site:reddit.com r/startups "vendor review" OR "SOC 2" enterprise B2B`,
  `YC funded AI SaaS company enterprise sales -compliance -soc2`,
  `AI platform startup raised Series A enterprise customers`,
  `"AI-powered" OR "AI-native" B2B SaaS startup enterprise customers product`,
  `site:techcrunch.com AI SaaS startup enterprise raises funding`,
  `site:ycombinator.com company AI SaaS enterprise customers`,
  `B2B AI devtools startup enterprise customers compliance security`,
  `IT managed service provider OR MSP enterprise clients "security review" OR "vendor questionnaire"`,
  `data processing OR data platform company enterprise customers compliance SOC2`,
  `site:producthunt.com "AI agent" OR copilot B2B enterprise launched`,
  `vertical AI startup healthcare OR legal OR finance enterprise customers`,
];

const REVENUE_QUERIES_A = [
  // Revenue ICP — Stripe subscription SaaS at scale.
  //
  // REWRITTEN 2026-07-31. The previous queries here were open web searches
  // ("SaaS startup Series A Stripe billing revenue scale") which return
  // ARTICLES ABOUT companies — TechCrunch pieces, listicles, blog posts —
  // not company entities. That is why 650 of 745 discovered companies scored
  // 1-2: the fit scorer was working correctly on journalism. These target
  // pages that ARE a company instead: job boards (a JD naming Stripe is a
  // VERIFIED Stripe user, currently spending), tech-stack directories, and
  // marketplace listings that publish MRR outright.
  `site:boards.greenhouse.io "Stripe" subscription OR billing engineer`,
  `site:job-boards.greenhouse.io "Stripe" billing OR payments OR subscription`,
  `site:jobs.lever.co "Stripe" subscription billing OR payments engineer`,
  `site:stackshare.io Stripe subscription SaaS stack`,
  `site:wellfound.com/company B2B SaaS subscription Stripe`,
  `site:ycombinator.com/companies B2B SaaS subscription billing`,
  // Acquire.com/Flippa sellers publish MRR outright — the only free source
  // that directly verifies the $50-150K band. A seller in diligence also has
  // acute motivation to clean up billing leakage before a buyer finds it.
  `site:acquire.com SaaS listing MRR Stripe subscription`,
  `site:flippa.com SaaS business "MRR" Stripe subscription recurring`,
  // Reddit — Revenue ICP intent signals
  `site:reddit.com r/stripe "failed payments" SaaS subscription`,
  `site:reddit.com r/SaaS "billing" Stripe subscription problem startup`,
  // Revenue ICP — membership/creator businesses on Stripe (segment 2)
  `paid community OR membership site Skool OR Circle OR "Mighty Networks" founder revenue`,
  `course creator Kajabi OR Podia OR Teachable business "failed payments" OR churn`,
  `paid newsletter OR membership business Stripe recurring revenue creator`,
  // Revenue ICP — scaling SaaS on Stripe ($50–150K MRR core band, corrected
  // 2026-07-09: was indie/bootstrapped $5–100K — too small, sub-$30K accounts
  // net only tens of $/mo on 10% performance pricing and can't be upsold to flat)
  `site:indiehackers.com SaaS "$50k MRR" OR "$100k MRR" OR "$150k MRR" Stripe`,
  `site:boards.greenhouse.io "revenue operations" OR RevOps SaaS subscription`,
  `site:jobs.lever.co billing OR subscriptions platform engineer SaaS`,
  `site:reddit.com r/SaaS "MRR" Series A OR "scaling" Stripe billing failed payments`,
  // Added 2026-07-31 with the Revenue repoint — more entity-source angles, the
  // principle that fixed the 88% reject rate: target pages that ARE a company.
  `site:boards.greenhouse.io "billing" OR "subscription" SaaS senior engineer`,
  `site:jobs.ashbyhq.com Stripe billing OR subscription SaaS`,
  `site:job-boards.greenhouse.io "RevOps" OR "revenue operations" subscription SaaS`,
  `site:stackshare.io "Stripe" "Chargebee" OR "Recurly" SaaS company stack`,
  `site:wellfound.com/company "subscription" B2B SaaS Series A`,
  `site:acquire.com SaaS "$10k MRR" OR "$20k MRR" OR "$50k MRR" subscription`,
  `site:flippa.com "SaaS" listing subscription monthly recurring Stripe`,
  `site:indiehackers.com "we hit" MRR SaaS subscription Stripe milestone`,
];

const TRUST_QUERIES_B = [
  `B2B SaaS startup "enterprise customers" "security review" OR "privacy review" raised`,
  `"AI Act" OR "AI regulation" B2B startup enterprise customers compliance`,
  `AI copilot OR assistant B2B startup "enterprise ready" OR "SOC 2"`,
  `B2B SaaS startup "enterprise" "SOC 2" working OR pursuing -vanta -drata`,
  `"AI vendor" review OR assessment enterprise procurement startup`,
  `site:reddit.com r/startups "security questionnaire" OR "trust page" B2B SaaS`,
  `AI startup founders "enterprise sales" "compliance" challenge 2025`,
  `site:techcrunch.com "raises" B2B SaaS startup enterprise 10 50 employees`,
  `"series A" AI startup B2B enterprise SaaS "just launched" OR "just raised"`,
  `site:producthunt.com "enterprise" AI SaaS tool launched`,
  `"we're hiring" B2B AI SaaS startup enterprise customers trust security`,
  `AI agent OR "AI assistant" startup enterprise B2B customers pilot`,
  `site:reddit.com r/SaaS "enterprise" "compliance" OR "security review" startup`,
  `fintech OR "data processor" startup enterprise customers "SOC 2" OR "security review"`,
  `IT services company OR managed security provider enterprise clients compliance`,
  `"model card" OR "AI transparency" startup enterprise buyers trust`,
  `site:techcrunch.com AI startup enterprise adoption security trust`,
  `generative AI startup B2B "series A" enterprise pilot customers`,
];

const REVENUE_QUERIES_B = [
  // Revenue ICP — fresh angles, same entity-source principle as SET_A
  // (see the rewrite note there: target pages that ARE a company, not
  // articles about companies).
  `site:boards.greenhouse.io "Stripe" SaaS engineer subscription`,
  `site:jobs.lever.co "Stripe" SaaS billing platform`,
  `site:job-boards.greenhouse.io SaaS "recurring revenue" OR subscription engineer`,
  `site:stackshare.io "Stripe" B2B SaaS billing tools`,
  `site:wellfound.com/company subscription SaaS billing payments`,
  `site:ycombinator.com/companies subscription SaaS Stripe payments`,
  `site:acquire.com SaaS "monthly recurring revenue" Stripe listing`,
  `site:flippa.com SaaS subscription "recurring revenue" Stripe business`,
  // Reddit — Revenue ICP intent signals
  `site:reddit.com r/startups "Stripe" billing subscription issue startup`,
  `site:reddit.com r/entrepreneurship "failed payments" OR "payment recovery" SaaS`,
  // Revenue ICP — membership/creator businesses on Stripe (segment 2, fresh angles)
  `Skool OR Circle community owner "monthly members" revenue business`,
  `membership site OR "online academy" founder Stripe subscriptions growing`,
  `site:reddit.com r/coursecreators "failed payments" OR Stripe OR churn`,
  // Revenue ICP — failed-payment pain, fresh angles
  `SaaS founder "involuntary churn" OR "failed payments" Stripe fix`,
  `subscription business "payment retries" OR dunning Stripe founder`,
  `site:indiehackers.com "failed payments" OR churn Stripe SaaS`,
  `site:reddit.com r/SaaS pricing upgrade billing Stripe founder`,
  // Added 2026-07-31 with the Revenue repoint.
  `site:boards.greenhouse.io "payments" OR "billing" team SaaS hiring`,
  `site:jobs.ashbyhq.com "subscription" OR "recurring revenue" SaaS engineer`,
  `site:jobs.lever.co "revenue operations" OR RevOps SaaS subscription`,
  `site:stackshare.io SaaS billing Stripe "subscription management"`,
  `site:wellfound.com/company SaaS "recurring revenue" payments Stripe`,
  `site:acquire.com "SaaS" profitable subscription business for sale MRR`,
  `site:flippa.com SaaS "subscribers" recurring Stripe monthly revenue`,
  `site:indiehackers.com SaaS founder "pricing change" OR "raised prices" Stripe`,
];

// Pick the query set for this run: alternate between sets. Discovery runs
// weekly (Mon), and consecutive Mondays are 7 days apart — an odd number — so
// day-parity alternation flips the set every run. Weekly rotation of a single
// set exhausted it (runs kept re-finding the same domains: found=187 new=0).
//
// Each set is Revenue-first, with Trust capped at TRUST_QUERY_LIMIT — see the
// allocation note above for why the split is no longer even.
function pickQuerySet(): { queries: string[]; label: "A" | "B" } {
  const dayNumber = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const useA = dayNumber % 2 === 0;
  return {
    label: useA ? "A" : "B",
    queries: useA
      ? [...REVENUE_QUERIES_A, ...TRUST_QUERIES_A.slice(0, TRUST_QUERY_LIMIT)]
      : [...REVENUE_QUERIES_B, ...TRUST_QUERIES_B.slice(0, TRUST_QUERY_LIMIT)],
  };
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

// Deliberately product-agnostic — query sets cover several ICPs (B2B SaaS,
// membership/creator platforms, self-funded employers, telehealth/pharmacy
// partners...) that grows over time. Gating extraction on any one of those
// descriptions would silently drop the others; fit-scorer.ts is where
// per-product ICP matching actually happens, not here.
const EXTRACT_SYSTEM = `You are extracting companies (organizations, businesses) mentioned in web search results.
For each company found in the results, extract their data. Only extract real companies — skip news sites, blogs, agencies, and marketplaces.

PRIORITIZE the long tail: small companies, indie SaaS products, and startups described by their own founders (e.g. a founder's product in a forum post, a "Show HN" launch, an IndieHackers milestone post) are the MOST valuable extractions. Extract them whenever the page names the product and you can determine its own domain. Do NOT limit yourself to famous companies that are merely name-dropped (payment processors, big vendors, well-known platforms mentioned in passing are the LEAST valuable).
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
    model: BULK_MODEL,
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

  // The label comes from the same call that picked the queries. It used to be
  // recomputed inline with a WEEK-based formula while selection was DAY-based,
  // so the log routinely named the set that had not run.
  const { queries, label } = pickQuerySet();
  console.log(
    `[discoverer] run=${runId} using query set ${label} (${queries.length} queries, ` +
    `Revenue-weighted: Trust capped at ${TRUST_QUERY_LIMIT})`,
  );

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
