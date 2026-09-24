// Central registry of every product Growth markets. All AI prompts that need
// product context (fit scoring, contact discovery, SEO, community, outreach)
// compose from this file, so adding or repositioning a product happens here
// and nowhere else.

export type MarketedProduct = "TRUST" | "REVENUE" | "DATA" | "WEB" | "BILLCLEAR" | "MEDSCAN" | "GROWTH_SERVICE";

export interface ProductProfile {
  key: MarketedProduct;
  name: string;
  /** Brand the outreach is sent under — Korrali products share a sender identity. */
  brand: "Korrali" | "BillClear" | "MedScan";
  url: string;
  /** For GROWTH_SERVICE and client campaigns: use campaign.customIcpProfile instead of this. */
  oneLiner: string;
  /** Fit-scoring guidance injected into the fit-scorer system prompt: good-fit signals + reject rules. */
  icp: string;
  /** Who buys — used by SEO/content prompts. */
  buyers: string;
  /** Quoted job-title search terms for contact discovery (most senior/relevant first). */
  personas: string[];
  /** False = consumer product; companies only qualify as partnership targets, and content/SEO carries the weight. */
  outboundViable: boolean;
  seoCta: string;
  /** The one next step an interested reply is given (reply-classifier drafts). */
  replyCta?: string;
  /** The concrete offer every cold step builds toward (email-generator). */
  outboundOffer?: { offer: string; link: string };
  /**
   * Where SEO topics come from for this product.
   *
   * "community" — mined from CommunityMention rows (Reddit/HN/IH scans). Works
   *   for products whose buyers complain in public forums we scan.
   * "catalog"   — generated from the product's own live tool pages + ICP text.
   *   Self-serve, long-tail products (Data, Web) have no forum constituency:
   *   nobody posts "my OFX won't open in Excel" on Hacker News, they just
   *   Google it. Mining community data for them yielded zero topics for
   *   ~4 days, so their topics are derived from real pages instead.
   */
  topicSourcing: "community" | "catalog";
  /**
   * Catalog products only: sitemap path prefixes that identify real, working
   * tool pages. Topics are generated ONLY against pages fetched live from the
   * product's sitemap and matching one of these, so an article can never
   * promote a tool that doesn't exist.
   */
  catalogSurfacePrefixes?: string[];
}

export const PRODUCTS: Record<MarketedProduct, ProductProfile> = {
  TRUST: {
    key: "TRUST",
    name: "Korrali Trust",
    brand: "Korrali",
    url: "https://trust.korrali.com",
    // Claims stay workflow-level (see positioning doctrine): it drafts answers
    // from the company's own documents for a human to approve. Never claim it
    // certifies, makes anyone compliant, or wins deals.
    oneLiner:
      "A workspace for answering enterprise security questionnaires: upload the questionnaire spreadsheet and your existing security docs, and it drafts answers with the source cited for each, flags what it can't support instead of guessing, and exports back into the original spreadsheet for your team to review and approve. Also covers the AI section (models, training data, oversight), policy drafts, and a public trust page. 14-day free trial, no card (up to 150 drafted answers); then $599/mo or $5,990/yr with unlimited questionnaires.",
    icp: `STRONGEST fit (score 8–10): AI-native B2B companies — they ship AI/LLM features (AI product, agents, copilots, ML models) AND sell to enterprise or mid-market. Their security reviews now include AI-specific sections (model inventory, training data provenance, EU AI Act risk classification, AI incident response) that block deals, and EU AI Act enforcement began August 2, 2026. If a company both ships AI and sells upmarket, score it 8+.

Good fit (score 6–10): Any B2B company that sells to enterprise OR mid-market (100+ employee buyers) and therefore faces vendor security reviews as a result. The real trigger is "sells to enterprise/mid-market buyers," not "is SaaS" — cloud or on-prem software, IT/managed service providers, data processors, fintechs, and any other B2B company that touches an enterprise customer's data or systems gets the same questionnaires a SaaS company does. Stronger signals: named enterprise/mid-market customers on their website, an "enterprise" pricing tier, a careers page showing they're hiring sales engineers or solutions engineers, recent funding (seed to series B), building integrations for enterprise tools (SSO, SAML, SCIM, Salesforce). Even stronger: mentions of SOC2 in progress, security page exists but is thin, no trust center yet.

ALWAYS REJECT — these are competitors or non-buyers for Trust:
- Any company whose core product IS compliance automation, security questionnaire management, trust center software, SOC2 readiness, vendor risk management, or GRC tooling. Named examples: Vanta, Drata, Secureframe, Scrut, TrustCloud, Tugboat Logic, Sprinto, Conveyor, SafeBase, Whistic, Hyperproof, Laika, Strike Graph. But apply this rule to ANY company fitting that description, not just named ones.
- Consumer apps, marketplaces, agencies, companies that already have a mature public trust center. Being non-software isn't itself disqualifying (an MSP or data processor selling to enterprise still qualifies) — but the company must genuinely be selling B2B into enterprise/mid-market accounts, not just any non-software business.

ALWAYS REJECT (score 1–3) regardless of other signals — these companies are not buyers yet:
- Fewer than 10 employees: too early-stage, no enterprise clients, no questionnaires incoming
- Founded less than 12 months ago: pre-sales or pre-product, compliance is not on their radar
- No visible product or customers: if there's no product page, no pricing, no case studies, they aren't selling yet
- Solo founder / side project: no organisational compliance exposure`,
    buyers:
      "CTOs, heads of security, compliance managers at 10–500 person B2B companies (software, IT services, or data processing) selling to enterprise.",
    personas: [
      '"head of security"',
      '"ciso"',
      '"vp security"',
      '"security lead"',
      '"head of trust"',
      '"compliance manager"',
      '"cto"',
    ],
    outboundViable: true,
    seoCta: "Start your free trial at trust.korrali.com",
    outboundOffer: {
      offer:
        "Try it on the next questionnaire they actually have to answer: 14-day free trial, no card — upload it with their existing security docs and see cited draft answers in their original spreadsheet.",
      link: "https://trust.korrali.com",
    },
    replyCta:
      "Start the free trial at https://trust.korrali.com (14 days, no card) and run it on the questionnaire they have due now; offer a 15-minute walkthrough of the drafted answers once it has run.",
    topicSourcing: "community",
  },

  REVENUE: {
    key: "REVENUE",
    name: "Korrali Revenue",
    brand: "Korrali",
    url: "https://revenue.korrali.com",
    // POSITIONING (rewritten 2026-09-24): lead with the free install from the
    // Stripe App Marketplace (approved 2026-09-07). The offer is "install it,
    // see what it flags in your own Stripe data, uninstall if it finds nothing"
    // — detection is free forever with no card, so the ask costs the prospect
    // nothing and needs no call.
    //
    // Keep every claim to what the product does. Do NOT say "read-only" (the
    // app writes to Stripe to run recoveries), do NOT quote the retired $499
    // one-time audit or $999 Scale plan, and describe drift/coupon findings as
    // things it flags for review, not proven leakage — an archived price or a
    // long-running coupon can be an agreed deal term.
    oneLiner:
      "A Stripe app (listed on the Stripe App Marketplace) that watches a subscription business's Stripe account for revenue that slips through: failed payments nobody retried, invoices stuck past due, charge-failure spikes, duplicate charges, subscriptions that stopped invoicing, customers still on a retired price, and coupons that never expired. Detection is free forever with no card; each finding shows the customer and dollar amount so it can be checked in the Stripe dashboard. Paying only unlocks acting on findings (retries, dunning, fixes) — first 3 recoveries free, then $99/mo under $25K MRR, $249/mo for $25K–$150K MRR, $499/mo above that, or 10% of what's recovered ($49/mo minimum).",
    icp: `GOOD FIT (score 7–9): independent subscription or usage-billed businesses that bill customers through Stripe — B2B/B2C SaaS, subscription apps, paid communities, memberships, course platforms — with roughly 10–200 employees. Pricing now scales from $99/mo, so small subscription companies are real customers, not just lead-gen: a 10–30 person SaaS on Stripe is a 7.
Score 9–10 when there are signs of billing complexity or volume: multiple pricing tiers, seat/usage pricing, annual + monthly plans, discounts/coupons in use, recent funding, or a growing customer base without a finance/RevOps team.
Score 6 when Stripe use or recurring billing is likely but not visible.
Score 4–5 when billing is probably not recurring (one-off purchases, services invoiced by hand) or not on Stripe.

ALWAYS REJECT — these are competitors or non-buyers for Revenue:
- Any company whose core product IS subscription analytics, revenue intelligence, failed payment recovery, dunning management, billing health monitoring, MRR/churn reporting, or subscription billing infrastructure. Named examples: Baremetrics, ChartMogul, ProfitWell, Maxio, Paddle, Recurly, Chargebee, Churnkey, Stunning, Gravy, Churnbuster, Payfunnels, Bleedpoint, MoonClerk. Apply this rule to ANY company fitting that description, not just named ones.
- Signals that a company IS a competitor: their product helps OTHER companies track MRR, recover failed payments, reduce churn, manage subscriptions, or monitor billing health.
- Agencies, consultancies, IT-services and outsourcing firms that bill by project or hour, one-time-purchase businesses with no recurring component, and enterprises with custom invoicing only or a dedicated billing engineering team.`,
    buyers:
      "Founders, CTOs, RevOps at subscription SaaS companies running on Stripe; owners of paid communities, course platforms, and membership businesses.",
    // Founder/CEO lead the list — contact-finder.ts already searches for
    // founder/CEO/co-founder ahead of anything else for companies under 50
    // employees (personasForProduct's SMALL_CO_PERSONAS override), which
    // covers most solo creator/community businesses. But that override only
    // kicks in below the 50-employee threshold, so a mid-sized course
    // platform or membership business with real headcount (support/content
    // teams, no engineering org) would otherwise only ever be searched
    // against "vp engineering" / "revops" / "cto" — titles that segment
    // rarely has. Founder/CEO are valid targets for the SaaS segment too,
    // so this doesn't cost anything there.
    personas: [
      '"founder"',
      '"ceo"',
      '"vp engineering"',
      '"head of engineering"',
      '"revops"',
      '"revenue operations"',
      '"vp finance"',
      '"head of finance"',
      '"cto"',
    ],
    outboundViable: true,
    seoCta: "See your revenue health for free at revenue.korrali.com",
    outboundOffer: {
      offer:
        "Try it free: install from the Stripe App Marketplace, see what it flags in their own Stripe data, uninstall if it finds nothing. No card, no call needed.",
      link: "https://marketplace.stripe.com/apps/korrali-revenue-recovery",
    },
    replyCta:
      "Install Korrali Revenue free from the Stripe App Marketplace (https://marketplace.stripe.com/apps/korrali-revenue-recovery) — it starts flagging as soon as it is connected, detection stays free with no card, and they can uninstall if it finds nothing. Offer to walk through the findings with them once it has run.",
    topicSourcing: "community",
  },

  DATA: {
    key: "DATA",
    name: "Korrali Data",
    brand: "Korrali",
    url: "https://data.korrali.com",
    oneLiner:
      "Convert, validate and repair business files for accounting and operations systems — OFX/QIF/XLSX to CSV, CSV health checks, duplicate-row finding, and platform-specific fixers (Xero, QuickBooks, Wise, Revolut, Stripe, PayPal, Square). Free preview, pay per file or a monthly plan.",
    icp: `Korrali Data is a low-ACV, high-volume self-serve SEO play, not an outbound target list — content should target the SEARCHER, not a company.

Good fit for article topics (score 6-10): bookkeepers, accountants, and small-business owners who hit a specific, nameable file problem — "OFX won't open in Excel", "QuickBooks rejecting my CSV import", "Xero bank feed CSV format wrong", "duplicate transactions in my bank export". These are long-tail, high-intent, low-competition queries tied to a specific working tool on the site.

ALWAYS REJECT as topics: generic "best accounting software" or "bookkeeping tips" content with no file-conversion angle — Data's tools only solve file-format and data-hygiene problems, not general bookkeeping advice, and content should stay tied to a real tool on data.korrali.com.`,
    buyers:
      "Bookkeepers, accountants, small-business owners, and data-migration specialists searching for a specific file-conversion or file-repair problem.",
    personas: ['"bookkeeper"', '"accountant"', '"controller"', '"operations manager"'],
    // Self-serve SEO/organic product, no sales motion — content only, no cold outreach.
    outboundViable: false,
    seoCta: "Convert or check your file free at data.korrali.com",
    topicSourcing: "catalog",
    catalogSurfacePrefixes: ["/tools/", "/banks/"],
  },

  WEB: {
    key: "WEB",
    name: "Korrali Web",
    brand: "Korrali",
    url: "https://web.korrali.com",
    oneLiner:
      "Deterministic public-website diagnostics — redirect chains, security headers, TLS/SSL certificates, page metadata, broken links, and mixed content. Free summary, unlock the full report or run ongoing monitoring.",
    icp: `Korrali Web is a low-ACV, high-volume self-serve SEO play, not an outbound target list — content should target the SEARCHER, not a company.

Good fit for article topics (score 6-10): site owners, agencies, and technical marketers searching for a specific, nameable website problem — "why is my site redirecting to the wrong URL", "check security headers online", "SSL certificate expiring warning", "find broken links on my website free", "meta tags checker". These map directly to a real check the tool performs.

ALWAYS REJECT as topics: generic "SEO tips" or "website design" content with no diagnostic angle — Web's tools only run deterministic technical checks, not design or content advice, and content should stay tied to a real check on web.korrali.com.`,
    buyers:
      "Site owners, agencies, and technical marketers searching for a specific website diagnostic problem.",
    personas: ['"site owner"', '"webmaster"', '"technical marketer"', '"agency owner"'],
    // Self-serve SEO/organic product, no sales motion — content only, no cold outreach.
    outboundViable: false,
    seoCta: "Check your website free at web.korrali.com",
    topicSourcing: "catalog",
    catalogSurfacePrefixes: ["/checkers/"],
  },

  BILLCLEAR: {
    key: "BILLCLEAR",
    name: "BillClear",
    brand: "BillClear",
    url: "https://getbillclear.app",
    oneLiner:
      "AI medical bill auditing — finds billing errors (duplicates, upcoding, No Surprises Act violations) and generates dispute letters, offered to employees as a benefit.",
    icp: `B2B only — we sell BillClear as an employee benefit, never door-to-door to patients.

Good fit (score 6–10): US companies with 50–5,000 employees offering health benefits, especially self-funded or level-funded plans (they directly eat billing errors, so the savings argument to the employer is direct). Strong signals: benefits/total-rewards roles on the careers page, mentions of self-funded or level-funded health plans, an internal HR/people-ops team, industries with high healthcare utilisation (manufacturing, logistics, retail, healthcare staffing). Also good: benefits brokers, benefits consultants, and TPAs (third-party administrators) who can offer BillClear across their book of clients, and HR-tech platforms that bundle employee benefits.

Also good fit (score 5–7): Fully-insured US employers of any size (50+ employees) offering health benefits. The direct-cost-savings argument to the employer is weaker here — the insurer bears claims risk, not the employer — but employee satisfaction/retention and total healthcare spend visibility are still real value, and fully-insured employers are a far larger market than self-funded alone. Don't reject a company just because it isn't confirmed self-funded.

ALWAYS REJECT: non-US companies (the product leans on US billing rules like the No Surprises Act), hospitals and provider groups (they are the counterparty to disputes), health insurers, companies under 50 employees (too small to have a benefits function to sell into), and competitors — medical bill negotiation or patient advocacy services (e.g. Goodbill, Resolve Medical Bills, CoPatient) or any company whose core product is medical bill review.`,
    buyers:
      "Heads of benefits / total rewards, CHROs, VPs of people at US companies with 50+ employees offering health benefits; benefits brokers and TPAs.",
    personas: [
      '"head of benefits"',
      '"total rewards"',
      '"chro"',
      '"vp people"',
      '"benefits manager"',
      '"hr manager"',
      '"benefits broker"',
      '"benefits consultant"',
    ],
    // 2026-07-07 portfolio freeze: BillClear is maintenance-only; no outbound.
    outboundViable: false,
    seoCta: "Audit any medical bill in 60 seconds at getbillclear.app",
    topicSourcing: "community",
  },

  MEDSCAN: {
    key: "MEDSCAN",
    name: "MedScan",
    brand: "MedScan",
    url: "https://medscan.app",
    oneLiner:
      "Consumer mobile app — photograph a medicine to identify it, see FDA label information, and check drug interactions.",
    icp: `MedScan is a consumer app, so companies only qualify as PARTNERSHIP targets, never as direct buyers.

Good fit (score 6–10, partnerships only): telehealth providers, independent and regional pharmacy chains, senior-care and home-care organisations, caregiver-support platforms, and pill-pack / medication-management services that could recommend or embed MedScan for their users. Also good fit: corporate wellness / EAP (employee assistance program) providers who distribute health tools to employees, and physical therapy / rehab / urgent-care clinics whose patients are managing multiple new medications — same "recommend or embed a free tool for your users" motion as telehealth.

ALWAYS REJECT: ordinary B2B SaaS companies (no reason to care about medicine scanning), hospitals' procurement arms, pharma manufacturers, and competitors — other medicine-identification or drug-interaction apps.`,
    buyers:
      "Consumers (patients, caregivers, seniors) reached via App Store search and SEO; partnership contacts at telehealth, pharmacy, and senior-care organisations.",
    personas: [
      '"head of partnerships"',
      '"business development"',
      '"clinical operations"',
      '"chief pharmacy officer"',
      '"ceo"',
    ],
    outboundViable: false,
    seoCta: "Scan any medicine free with MedScan — medscan.app",
    topicSourcing: "community",
  },

  GROWTH_SERVICE: {
    key: "GROWTH_SERVICE",
    name: "Korrali Growth Engine",
    brand: "Korrali",
    url: "https://korrali.com",
    oneLiner:
      "AI-powered done-for-you B2B outreach — we find your ICP, verify every email, and run personalized sequences so you wake up to interested replies.",
    icp: `Good fit (score 6-10): Early-stage B2B founders or co-founders with 2-20 employees, 6-36 months old, selling to other businesses, bootstrapped or seed-stage, no dedicated sales hire yet. Doesn't need to be SaaS — any B2B company (software, services, or product) that needs outbound and can't yet justify a full-time SDR has the identical pain and qualifies equally.

Observable signals: recent ProductHunt launch, Indie Hackers post, Y Combinator batch, blog post about getting first customers, LinkedIn content about struggling with sales or outbound.

Pain: no time for outbound, can't afford a $70K SDR, have tried cold email and either burned their domain or given up, rely entirely on inbound/referrals.

ALWAYS REJECT: companies with a sales team (AE/SDR job titles visible on LinkedIn), agencies (they either do their own outbound or compete with this exact service), consumer apps, companies that sell outbound/SDR tools themselves.`,
    buyers: "Founders, co-founders of early-stage B2B startups.",
    personas: ['"founder"', '"co-founder"', '"ceo"', '"cto"'],
    // 2026-07-07: DFY SDR service sunset; Growth is internal-only. No outbound.
    outboundViable: false,
    seoCta: "Book a 15-min demo at korrali.com",
    topicSourcing: "community",
  },
};

export const MARKETED_PRODUCT_KEYS = Object.keys(PRODUCTS) as MarketedProduct[];

/** "**Korrali Trust** — one-liner" blocks, the standard way prompts enumerate the catalogue. */
export function productCatalogueBlock(): string {
  return MARKETED_PRODUCT_KEYS.map(
    (k) => `**${PRODUCTS[k].name}** (${k}) — ${PRODUCTS[k].oneLiner}`,
  ).join("\n\n");
}
