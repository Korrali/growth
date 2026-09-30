import Papa from "papaparse";
import { normalizeDomain } from "@/lib/import/csv-parser";

// Turns an Apollo "Export contacts" CSV into leads Growth can send to.
//
// Filtering happens here, before anything touches the database, so a bad
// export can be inspected with --dry-run and every drop has a named reason.
// Rules:
//  - verified email only (Apollo "Email Status" = Verified); extrapolated and
//    unavailable addresses bounce, and bounces damage the sending domain
//  - decision-makers only (founder/CEO/owner/president or finance/RevOps) —
//    the same buyer bar the send-eligibility gate enforces via isBuyer
//  - no acquired companies or subsidiaries: their billing moved to a parent
//  - one contact per company (the best-ranked title wins, see titleRank),
//    matching auto-enroll's one-contact-per-company rule
//  - product "ROUTE" sends Stripe-billing companies to Revenue and everyone
//    else to Trust, so mixed lists are cross-used without double-booking

export interface ApolloLead {
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string;
  linkedinUrl: string | null;
  companyName: string;
  domain: string;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  technologies: string[];
  description: string | null;
  country: string | null;
  /** Product this lead is imported for (see routeProduct for ROUTE mode). */
  product: string;
}

export type SkipReason =
  | "no_email"
  | "email_not_verified"
  | "not_decision_maker"
  | "acquired_or_subsidiary"
  | "no_domain"
  | "duplicate_email"
  | "second_contact_same_company";

export interface ApolloParseResult {
  leads: ApolloLead[];
  skipped: Partial<Record<SkipReason, number>>;
}

// Who counts as a decision-maker differs by product: Revenue sells to whoever
// owns the Stripe money (founders, finance); Trust sells to whoever answers the
// security questionnaire (CTO, security, compliance — or the founder).
const BUYER_TITLES: Record<string, RegExp> = {
  REVENUE:
    /\b(founder|co-?founder|ceo|chief executive|owner|president|cfo|chief financial|finance|financial|controller|revops|revenue operations|head of revenue)\b/i,
  TRUST:
    /\b(founder|co-?founder|ceo|chief executive|owner|president|cto|chief technology|chief technical|ciso|chief information security|security|compliance|grc|trust|vp,? (of )?engineering|vice president,? (of )?engineering|head of engineering)\b/i,
};

// Service firms (FIRM campaigns) are run by partners and principals, titles
// that at a product company would not mark the buyer ("Principal Engineer").
const FIRM_BUYER_TITLES =
  /\b(partner|principal|managing director|v-?ciso|virtual ciso|fractional)\b/i;

const ACQUIRED = /\bacq(\.|uired)?\b|\bacquired by\b|\ba (division|subsidiary) of\b/i;

// Apollo lists 50–100+ technologies per company. The fit scorer only needs the
// billing-relevant ones plus a sample, so the prompt stays small.
const BILLING_TECH = /stripe|chargebee|recurly|paddle|chargify|maxio|zuora|braintree|paypal|baremetrics|chartmogul|profitwell|memberstack|kajabi|teachable|podia|circle|skool|patreon|substack|shopify/i;
const MAX_TECHS = 25;

export function relevantTechnologies(raw: string): string[] {
  const all = [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];
  const billing = all.filter((t) => BILLING_TECH.test(t));
  const rest = all.filter((t) => !BILLING_TECH.test(t));
  return [...billing, ...rest].slice(0, MAX_TECHS);
}

/**
 * ROUTE mode: a company that bills through Stripe is a Revenue prospect,
 * anyone else a Trust prospect. Each company ends up in exactly one product.
 */
export function routeProduct(technologies: string): "REVENUE" | "TRUST" {
  return /\bstripe\b/i.test(technologies) ? "REVENUE" : "TRUST";
}

// When a company has several contacts, keep the likeliest buyer: the founder
// decides for both products at a small company; then the product's own owner.
const TITLE_RANK: [RegExp, number][] = [
  [/\b(founder|co-?founder|ceo|chief executive|owner|president)\b/i, 1],
  [/\b(cfo|chief financial|finance|controller|revops|revenue operations|ciso|chief information security|security|compliance)\b/i, 2],
  [/\b(cto|chief technology|chief technical)\b/i, 3],
];
export function titleRank(title: string): number {
  return TITLE_RANK.find(([re]) => re.test(title))?.[1] ?? 4;
}

export function isBuyerTitle(title: string, product = "REVENUE", firm = false): boolean {
  if (firm && FIRM_BUYER_TITLES.test(title)) return true;
  return (BUYER_TITLES[product] ?? BUYER_TITLES.REVENUE!).test(title);
}

function col(row: Record<string, string>, name: string): string {
  return (row[name] ?? "").trim();
}

function describe(row: Record<string, string>): string | null {
  const parts = [
    col(row, "Keywords") && `Keywords: ${col(row, "Keywords").slice(0, 600)}`,
    col(row, "Total Funding") && `Total funding: ${col(row, "Total Funding")}`,
    col(row, "Latest Funding") && `Latest round: ${col(row, "Latest Funding")}${col(row, "Last Raised At") ? ` (${col(row, "Last Raised At")})` : ""}`,
    col(row, "Annual Revenue") && `Annual revenue (Apollo estimate): ${col(row, "Annual Revenue")}`,
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export function parseApolloCsv(
  text: string,
  existingEmails: Set<string> = new Set(),
  product = "REVENUE",
  opts: { firm?: boolean } = {},
): ApolloParseResult {
  const { data } = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });

  const skipped: ApolloParseResult["skipped"] = {};
  const skip = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const seenEmails = new Set([...existingEmails].map((e) => e.toLowerCase()));
  const byDomain = new Map<string, ApolloLead>();

  for (const row of data) {
    const email = col(row, "Email").toLowerCase();
    if (!email) { skip("no_email"); continue; }
    if (col(row, "Email Status").toLowerCase() !== "verified") { skip("email_not_verified"); continue; }

    const technologies = col(row, "Technologies");
    const leadProduct = product === "ROUTE" ? routeProduct(technologies) : product;
    // Routed to Revenue by Stripe usage, a CTO still owns the Stripe
    // integration, so Revenue also accepts Trust's technical titles there.
    const title = col(row, "Title");
    const buyer = isBuyerTitle(title, leadProduct, opts.firm) ||
      (product === "ROUTE" && leadProduct === "REVENUE" && isBuyerTitle(title, "TRUST"));
    if (!buyer) { skip("not_decision_maker"); continue; }

    const companyName = col(row, "Company Name");
    if (ACQUIRED.test(companyName) || col(row, "Parent company (Apollo data)")) {
      skip("acquired_or_subsidiary");
      continue;
    }

    const website = col(row, "Website");
    const domain = normalizeDomain(website) || email.split("@")[1] || "";
    if (!domain) { skip("no_domain"); continue; }

    if (seenEmails.has(email)) { skip("duplicate_email"); continue; }
    seenEmails.add(email);

    const employees = parseInt(col(row, "# Employees"), 10);
    const lead: ApolloLead = {
      email,
      firstName: col(row, "First Name") || null,
      lastName: col(row, "Last Name") || null,
      title,
      linkedinUrl: col(row, "Person Linkedin Url") || null,
      companyName: companyName || domain,
      domain,
      website: website ? (website.startsWith("http") ? website : `https://${website}`) : null,
      industry: col(row, "Industry") || null,
      employeeCount: Number.isFinite(employees) ? employees : null,
      technologies: relevantTechnologies(technologies),
      description: describe(row),
      country: col(row, "Country") || col(row, "Company Country") || null,
      product: leadProduct,
    };

    // One contact per company: the best-ranked title wins, ties keep the first.
    const current = byDomain.get(domain);
    if (current && titleRank(current.title) <= titleRank(title)) {
      skip("second_contact_same_company");
      continue;
    }
    if (current) skip("second_contact_same_company");
    byDomain.set(domain, lead);
  }

  const leads = [...byDomain.values()];
  return { leads, skipped };
}
