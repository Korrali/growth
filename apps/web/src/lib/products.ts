// Central registry of every product Growth markets. All AI prompts that need
// product context (fit scoring, contact discovery, SEO, community, outreach)
// compose from this file, so adding or repositioning a product happens here
// and nowhere else.

export type MarketedProduct = "TRUST" | "REVENUE" | "BILLCLEAR" | "MEDSCAN" | "GROWTH_SERVICE";

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
}

export const PRODUCTS: Record<MarketedProduct, ProductProfile> = {
  TRUST: {
    key: "TRUST",
    name: "Korrali Trust",
    brand: "Korrali",
    url: "https://trust.korrali.com",
    oneLiner:
      "Compliance and trust workspace — answer security questionnaires in minutes, generate SOC2/ISO27001 policy docs, and publish a public trust page.",
    icp: `Good fit (score 6–10): Any B2B SaaS that sells to enterprise OR mid-market (100+ employee buyers). The company doesn't need to be AI-native — any SaaS product used by large companies faces questionnaires. Stronger signals: named enterprise/mid-market customers on their website, an "enterprise" pricing tier, a careers page showing they're hiring sales engineers or solutions engineers, recent funding (seed to series B), building integrations for enterprise tools (SSO, SAML, SCIM, Salesforce). Even stronger: mentions of SOC2 in progress, security page exists but is thin, no trust center yet.

ALWAYS REJECT — these are competitors or non-buyers for Trust:
- Any company whose core product IS compliance automation, security questionnaire management, trust center software, SOC2 readiness, vendor risk management, or GRC tooling. Named examples: Vanta, Drata, Secureframe, Scrut, TrustCloud, Tugboat Logic, Sprinto, Conveyor, SafeBase, Whistic, Hyperproof, Laika, Strike Graph. But apply this rule to ANY company fitting that description, not just named ones.
- Consumer apps, marketplaces, agencies, non-software businesses, companies that already have a mature public trust center.

ALWAYS REJECT (score 1–3) regardless of other signals — these companies are not buyers yet:
- Fewer than 10 employees: too early-stage, no enterprise clients, no questionnaires incoming
- Founded less than 12 months ago: pre-sales or pre-product, compliance is not on their radar
- No visible product or customers: if there's no product page, no pricing, no case studies, they aren't selling yet
- Solo founder / side project: no organisational compliance exposure`,
    buyers:
      "CTOs, heads of security, compliance managers at 10–500 person SaaS companies selling to enterprise.",
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
  },

  REVENUE: {
    key: "REVENUE",
    name: "Korrali Revenue",
    brand: "Korrali",
    url: "https://revenue.korrali.com",
    oneLiner:
      "Revenue recovery for Stripe businesses — detects failed payments, revenue leakage, duplicate charges, and billing anomalies, then recovers the money. The headline offer is performance pricing: pay nothing unless we recover revenue (10% of recovered, capped at $5K/mo). A one-time $499 Stripe revenue audit is the low-commitment entry point.",
    icp: `Good fit (score 6–10): Any subscription business on Stripe doing meaningful volume. The sweet spot is $50K+ MRR — there 3–8% revenue leakage is thousands of dollars a month and statistically near-certain. Businesses under ~$10K MRR usually have too little volume to show leaks; score them 4–5 unless other signals are strong. Two segments qualify equally:
1. Subscription SaaS: subscription or usage-based pricing, engineering team small relative to customer base (billing is deprioritised), scaling MRR (post-revenue seed to series B), Stripe in tech stack or job postings, no billing-ops/RevOps hire, multiple pricing tiers or seat-based billing.
2. Membership and creator businesses on Stripe: paid communities (Skool, Circle, Mighty Networks), course platforms (Kajabi, Podia, Teachable), paid newsletters, membership sites, coaching programs with recurring billing. These have worse payment hygiene than SaaS and no tooling culture — high leak rates and zero incumbent competition.

ALWAYS REJECT — these are competitors or non-buyers for Revenue:
- Any company whose core product IS subscription analytics, revenue intelligence, failed payment recovery, dunning management, billing health monitoring, MRR/churn reporting, or subscription billing infrastructure. Named examples: Baremetrics, ChartMogul, ProfitWell, Maxio (formerly ProfitWell), Paddle (billing platform), Recurly, Chargebee, Stunning, Gravy, Churnbuster, Payfunnels, Stripe Radar, MoonClerk. Apply this rule to ANY company fitting that description, not just named ones.
- Signals that a company IS a competitor: their product helps OTHER SaaS companies track MRR, recover failed payments, reduce churn, manage subscriptions, or monitor billing health. If their customers are SaaS founders using their tool to understand their own revenue — they are a competitor.
- One-time-purchase businesses with no recurring component, services firms and agencies billing by invoice, companies with dedicated billing engineering teams, enterprise companies with custom invoicing only.`,
    buyers:
      "Founders, CTOs, RevOps at subscription SaaS companies running on Stripe; owners of paid communities, course platforms, and membership businesses.",
    personas: [
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
  },

  BILLCLEAR: {
    key: "BILLCLEAR",
    name: "BillClear",
    brand: "BillClear",
    url: "https://getbillclear.app",
    oneLiner:
      "AI medical bill auditing — finds billing errors (duplicates, upcoding, No Surprises Act violations) and generates dispute letters, offered to employees as a benefit.",
    icp: `B2B only — we sell BillClear as an employee benefit, never door-to-door to patients.

Good fit (score 6–10): US companies with 100–5,000 employees, especially self-funded health plans (they directly eat billing errors). Strong signals: benefits/total-rewards roles on the careers page, mentions of self-funded or level-funded health plans, an internal HR/people-ops team, industries with high healthcare utilisation (manufacturing, logistics, retail, healthcare staffing). Also good: benefits brokers, benefits consultants, and TPAs (third-party administrators) who can offer BillClear across their book of clients, and HR-tech platforms that bundle employee benefits.

ALWAYS REJECT: non-US companies (the product leans on US billing rules like the No Surprises Act), hospitals and provider groups (they are the counterparty to disputes), health insurers, companies under 50 employees, and competitors — medical bill negotiation or patient advocacy services (e.g. Goodbill, Resolve Medical Bills, CoPatient) or any company whose core product is medical bill review.`,
    buyers:
      "Heads of benefits / total rewards, CHROs, VPs of people at 100–5,000 employee US companies; benefits brokers and TPAs.",
    personas: [
      '"head of benefits"',
      '"total rewards"',
      '"chro"',
      '"vp people"',
      '"benefits manager"',
      '"benefits broker"',
      '"benefits consultant"',
    ],
    outboundViable: true,
    seoCta: "Audit any medical bill in 60 seconds at getbillclear.app",
  },

  MEDSCAN: {
    key: "MEDSCAN",
    name: "MedScan",
    brand: "MedScan",
    url: "https://medscan.app",
    oneLiner:
      "Consumer mobile app — photograph a medicine to identify it, see FDA label information, and check drug interactions.",
    icp: `MedScan is a consumer app, so companies only qualify as PARTNERSHIP targets, never as direct buyers.

Good fit (score 6–10, partnerships only): telehealth providers, independent and regional pharmacy chains, senior-care and home-care organisations, caregiver-support platforms, and pill-pack / medication-management services that could recommend or embed MedScan for their users.

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
  },

  GROWTH_SERVICE: {
    key: "GROWTH_SERVICE",
    name: "Korrali Growth Engine",
    brand: "Korrali",
    url: "https://korrali.com",
    oneLiner:
      "AI-powered done-for-you B2B outreach — we find your ICP, verify every email, and run personalized sequences so you wake up to interested replies.",
    icp: `Good fit (score 6-10): B2B SaaS founders or co-founders with 2-20 employees, 6-36 months old, selling to other businesses, bootstrapped or seed-stage, no dedicated sales hire yet.

Observable signals: recent ProductHunt launch, Indie Hackers post, Y Combinator batch, blog post about getting first customers, LinkedIn content about struggling with sales or outbound.

Pain: no time for outbound, can't afford a $70K SDR, have tried cold email and either burned their domain or given up, rely entirely on inbound/referrals.

ALWAYS REJECT: companies with a sales team (AE/SDR job titles visible on LinkedIn), agencies, non-SaaS businesses, consumer apps, companies that sell outbound/SDR tools themselves.`,
    buyers: "Founders, co-founders of B2B SaaS startups.",
    personas: ['"founder"', '"co-founder"', '"ceo"', '"cto"'],
    outboundViable: true,
    seoCta: "Book a 15-min demo at korrali.com",
  },
};

export const MARKETED_PRODUCT_KEYS = Object.keys(PRODUCTS) as MarketedProduct[];

/** "**Korrali Trust** — one-liner" blocks, the standard way prompts enumerate the catalogue. */
export function productCatalogueBlock(): string {
  return MARKETED_PRODUCT_KEYS.map(
    (k) => `**${PRODUCTS[k].name}** (${k}) — ${PRODUCTS[k].oneLiner}`,
  ).join("\n\n");
}
