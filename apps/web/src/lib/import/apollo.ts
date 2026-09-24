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
//  - one contact per company (the first qualifying row wins), matching
//    auto-enroll's one-contact-per-company rule

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

export function isBuyerTitle(title: string, product = "REVENUE"): boolean {
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
  const seenDomains = new Set<string>();
  const leads: ApolloLead[] = [];

  for (const row of data) {
    const email = col(row, "Email").toLowerCase();
    if (!email) { skip("no_email"); continue; }
    if (col(row, "Email Status").toLowerCase() !== "verified") { skip("email_not_verified"); continue; }

    const title = col(row, "Title");
    if (!isBuyerTitle(title, product)) { skip("not_decision_maker"); continue; }

    const companyName = col(row, "Company Name");
    if (ACQUIRED.test(companyName) || col(row, "Parent company (Apollo data)")) {
      skip("acquired_or_subsidiary");
      continue;
    }

    const website = col(row, "Website");
    const domain = normalizeDomain(website) || email.split("@")[1] || "";
    if (!domain) { skip("no_domain"); continue; }

    if (seenEmails.has(email)) { skip("duplicate_email"); continue; }
    if (seenDomains.has(domain)) { skip("second_contact_same_company"); continue; }
    seenEmails.add(email);
    seenDomains.add(domain);

    const employees = parseInt(col(row, "# Employees"), 10);
    leads.push({
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
      technologies: relevantTechnologies(col(row, "Technologies")),
      description: describe(row),
      country: col(row, "Country") || col(row, "Company Country") || null,
    });
  }

  return { leads, skipped };
}
