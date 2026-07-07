import dns from "node:dns/promises";
import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { HIGH_INTENT_MODEL } from "@/lib/ai/models";
import { enqueueEmailGenerate, enqueueOutreachSend } from "@/lib/queue";
import { EmailStatus, type FitProduct } from "@prisma/client";
import { PRODUCTS, type MarketedProduct } from "@/lib/products";
import { pickDeliverableEmail } from "@/lib/import/email-verifier";

// ─── Persona targeting by product ────────────────────────────────────────────

// For companies < 50 employees always add founder/CEO
const SMALL_CO_PERSONAS = ['"ceo"', '"founder"', '"co-founder"'];

// Titles that indicate a buying decision-maker. Anyone else (engineer, intern,
// analyst, etc.) found incidentally should not enter the outreach pipeline.
const BUYER_TITLE_PATTERNS = [
  /\b(ceo|cto|ciso|coo|cfo|cpo)\b/i,
  /\b(founder|co-founder|cofounder)\b/i,
  /\b(vp|vice president)\b.*(engineer|security|product|finance|revenue|infra)/i,
  /\b(head|director)\s+of\s+(security|trust|compliance|engineering|product|finance|revenue|infra)/i,
  /\b(engineering|security|compliance|product|revenue)\s+(manager|lead|director)\b/i,
  /\brevops\b/i,
  /\bchief\b/i,
];

function isBuyerTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return BUYER_TITLE_PATTERNS.some((re) => re.test(title));
}

function personasForProduct(fitProduct: FitProduct, employeeCount: number | null): string[] {
  // BOTH = the Korrali pair; Trust personas lead because that campaign is preferred downstream
  const key = fitProduct === "BOTH" ? "TRUST" : (fitProduct as MarketedProduct);
  const base = PRODUCTS[key].personas;
  const isSmall = !employeeCount || employeeCount < 50;
  return isSmall ? [...SMALL_CO_PERSONAS, ...base] : base;
}

// ─── Anymail Finder (optional paid finder — set ANYMAILFINDER_API_KEY) ────────
// Decision-maker search returns a live-verified email in one call: no name
// discovery, no pattern guessing, no separate verification, no Tavily credits.
// Billing is per VERIFIED email only — misses and risky results are free, so
// falling back to the free Tavily+patterns path on a miss costs nothing.

interface AmfContact {
  email: string;
  firstName: string;
  lastName: string | null;
  title: string;
  verified: boolean;
}

function splitFullName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function findViaAnymailFinder(company: { name: string; domain: string }): Promise<AmfContact | null> {
  const apiKey = process.env.ANYMAILFINDER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.anymailfinder.com/v5.1/find-email/decision-maker", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ domain: company.domain, decision_maker_category: ["ceo"] }),
    });
    // Not-found (no charge) or any API error → fall back to the free path.
    if (!res.ok) return null;

    // Field names parsed defensively — AMF nests results differently across
    // endpoint versions; accept both flat and results-wrapped shapes.
    const raw = (await res.json()) as Record<string, unknown>;
    const body = (raw.results ?? raw) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : null;
    const status = typeof body.email_status === "string" ? body.email_status : null;
    if (!email || !email.includes("@") || (status !== "valid" && status !== "risky")) return null;

    const fullName =
      (typeof body.person_full_name === "string" && body.person_full_name) ||
      (typeof body.full_name === "string" && body.full_name) ||
      "";
    let { firstName, lastName } = splitFullName(fullName);
    if (!firstName) {
      // Personalization needs *something*; the mailbox localpart is the best
      // available guess when AMF returns no name.
      const local = email.split("@")[0].split(/[._-]/)[0];
      firstName = local.charAt(0).toUpperCase() + local.slice(1);
      lastName = null;
    }
    const title =
      (typeof body.person_job_title === "string" && body.person_job_title) ||
      (typeof body.job_title === "string" && body.job_title) ||
      "CEO";

    return { email: email.toLowerCase(), firstName, lastName, title, verified: status === "valid" };
  } catch {
    return null;
  }
}

// ─── Tavily search ────────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(query: string, maxResults = 5): Promise<SearchResult[]> {
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
    }),
  });

  if (!res.ok) throw new Error(`Tavily error ${res.status}`);

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
}

// ─── Claude extraction ────────────────────────────────────────────────────────

interface ExtractedContact {
  firstName: string;
  lastName: string;
  title: string;
  linkedinUrl: string | null;
  confidence: number; // 1-10
}

const EXTRACT_SYSTEM = `Extract a B2B contact person from search results for a target company.
Return the single best match — the most senior relevant person you can find.
If no real person is found, return null for all fields and confidence 0.
Respond with valid JSON only.`;

const EXTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    firstName:   { type: "string" },
    lastName:    { type: "string" },
    title:       { type: "string" },
    linkedinUrl: { type: ["string", "null"] },
    confidence:  { type: "number", description: "1-10, how confident this is the right person" },
  },
  required: ["firstName", "lastName", "title", "linkedinUrl", "confidence"],
  additionalProperties: false,
};

async function extractContact(
  results: SearchResult[],
  companyName: string,
  personas: string[],
): Promise<ExtractedContact | null> {
  if (results.length === 0) return null;

  const snippets = results
    .map((r) => `[${r.title}]\n${r.url}\n${r.content}`)
    .join("\n\n---\n\n");

  const response = await anthropic.messages.create({
    model: HIGH_INTENT_MODEL,
    max_tokens: 256,
    system: [{ type: "text", text: EXTRACT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Company: ${companyName}\nLooking for: ${personas.slice(0, 4).join(", ")}\n\nSearch results:\n${snippets}`,
    }],
    output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;

  try {
    const parsed = JSON.parse(block.text) as ExtractedContact;
    return parsed.confidence >= 4 ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Email pattern generation ─────────────────────────────────────────────────

// Ordered by frequency in B2B SaaS (most common first)
export function generateEmailPatterns(
  firstName: string,
  lastName: string,
  domain: string,
): string[] {
  const f = firstName.toLowerCase().trim();
  const l = lastName.toLowerCase().trim();
  if (!f || !l || !domain) return [];

  return [
    `${f}@${domain}`,
    `${f}.${l}@${domain}`,
    `${f[0]}.${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${f[0]}${l}@${domain}`,
    `${l}@${domain}`,
  ];
}

// ─── MX record check (confirms domain accepts email at all) ──────────────────

async function domainHasMx(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

// ─── Auto-outreach: find active campaign + create outreach ───────────────────

async function autoEnqueueOutreach(
  contactId: string,
  companyId: string,
  fitProduct: FitProduct,
): Promise<boolean> {
  // Find a standing active campaign for this product
  // BOTH → prefer TRUST campaign; REJECT is already filtered upstream
  const product = fitProduct === "BOTH" ? "TRUST" : (fitProduct as MarketedProduct);

  // Belt-and-suspenders: findContactForCompany already skips discovery for
  // non-outbound-viable products, but this function can also be reached via
  // the "existing contact" path, so check again here rather than trust the
  // caller. sendOutreachStep's eligibility gate is the true last line of
  // defense regardless — this just avoids creating the Outreach row at all.
  if (!PRODUCTS[product]?.outboundViable) return false;

  const campaign = await prisma.campaign.findFirst({
    where: { product, status: "ACTIVE" },
    orderBy: { createdAt: "asc" }, // oldest = most established campaign
  });

  if (!campaign) return false; // no active campaign yet — contact stored, outreach created when campaign goes live

  // Upsert outreach (idempotent if called twice)
  const outreach = await prisma.outreach.upsert({
    where: { contactId_campaignId: { contactId, campaignId: campaign.id } },
    create: {
      contactId,
      campaignId: campaign.id,
      companyId,
      status: "PENDING",
      currentStep: 1,
    },
    update: {},
  });

  await enqueueEmailGenerate({ outreachId: outreach.id });
  await enqueueOutreachSend({ outreachId: outreach.id, stepNumber: 1 });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "contact.auto_outreach_created",
      entity: "Outreach",
      entityId: outreach.id,
      metadata: { contactId, campaignId: campaign.id, fitProduct },
    },
  });

  return true;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function findContactForCompany(companyId: string): Promise<void> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  if (!company.fitProduct || company.fitProduct === "REJECT") return;
  if (!company.domain) return;

  // Never spend a Tavily/Claude call discovering a contact for a product
  // that isn't outbound-viable (e.g. MedScan — consumer app, not ready for
  // outreach). autoEnqueueOutreach has its own belt-and-suspenders check
  // for the "existing contact" path below, but there's no reason to run
  // the discovery search at all if we already know we won't act on it.
  const discoveryProductKey =
    company.fitProduct === "BOTH" ? "TRUST" : (company.fitProduct as MarketedProduct);
  if (!PRODUCTS[discoveryProductKey]?.outboundViable) return;

  // Skip if we already have a non-suppressed contact for this company
  const existing = await prisma.contact.findFirst({
    where: { companyId, suppressedAt: null },
  });
  if (existing) {
    // Still try to create outreach if none exists
    await autoEnqueueOutreach(existing.id, companyId, company.fitProduct);
    return;
  }

  // Paid finder first when configured: one call, live-verified email, no
  // Tavily spend. Falls through to the free path on miss (misses cost $0).
  const amf = await findViaAnymailFinder(company);
  if (amf) {
    const amfContact = await prisma.contact.upsert({
      where: { email: amf.email },
      create: {
        email: amf.email,
        firstName: amf.firstName,
        lastName: amf.lastName,
        title: amf.title,
        companyId,
        emailStatus: amf.verified ? EmailStatus.VALID : EmailStatus.CATCH_ALL,
        isBuyer: isBuyerTitle(amf.title),
      },
      update: {
        companyId,
        emailStatus: amf.verified ? EmailStatus.VALID : EmailStatus.CATCH_ALL,
      },
    });
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "contact.found",
        entity: "Contact",
        entityId: amfContact.id,
        metadata: {
          companyName: company.name,
          email: amf.email,
          title: amf.title,
          source: "anymailfinder",
          verification: amf.verified ? "deliverable" : "risky",
        },
      },
    });
    await autoEnqueueOutreach(amfContact.id, companyId, company.fitProduct);
    return;
  }

  const personas = personasForProduct(company.fitProduct, company.employeeCount);

  // Build search queries — two passes: LinkedIn search + company team page
  const titleQuery = personas.slice(0, 3).join(" OR ");
  const linkedinQuery = `"${company.name}" (${titleQuery}) site:linkedin.com/in`;
  const teamQuery = `"${company.name}" (${titleQuery}) contact email`;

  const [linkedinResults, teamResults] = await Promise.all([
    tavilySearch(linkedinQuery, 5).catch(() => [] as SearchResult[]),
    tavilySearch(teamQuery, 5).catch(() => [] as SearchResult[]),
  ]);

  const allResults = [...linkedinResults, ...teamResults];
  const contact = await extractContact(allResults, company.name, personas);

  if (!contact || !contact.firstName || !contact.lastName) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "contact.find.no_result",
        entity: "Company",
        entityId: companyId,
        metadata: { companyName: company.name, domain: company.domain },
      },
    });
    return;
  }

  // Confirm domain accepts email before creating anything
  const hasMx = await domainHasMx(company.domain);
  if (!hasMx) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "contact.find.no_mx",
        entity: "Company",
        entityId: companyId,
        metadata: { domain: company.domain },
      },
    });
    return;
  }

  // Verify the mailbox BEFORE creating/sending. Blindly sending patterns[0] and
  // letting bounces suppress invalids afterward destroyed sender reputation
  // (~50% wrong guesses → hard bounces). Now we verify each candidate and send
  // only a confirmed-deliverable (or, for catch-all domains, "risky") mailbox.
  const patterns = generateEmailPatterns(contact.firstName, contact.lastName, company.domain);
  const picked = await pickDeliverableEmail(patterns);
  if (!picked) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "contact.find.unverified",
        entity: "Company",
        entityId: companyId,
        metadata: {
          companyName: company.name,
          domain: company.domain,
          candidatesTried: patterns.length,
          reason: "no deliverable mailbox (or verification not configured — fail-closed)",
        },
      },
    });
    return;
  }
  const primaryEmail = picked.email;

  // Create contact — mailbox verified above; Resend bounce webhook remains a backup net
  const newContact = await prisma.contact.upsert({
    where: { email: primaryEmail },
    create: {
      email: primaryEmail,
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      linkedinUrl: contact.linkedinUrl ?? undefined,
      companyId,
      isBuyer: isBuyerTitle(contact.title),
    },
    update: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      linkedinUrl: contact.linkedinUrl ?? undefined,
      companyId,
      // Re-evaluate buyer status if title was updated
      isBuyer: isBuyerTitle(contact.title),
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "contact.found",
      entity: "Contact",
      entityId: newContact.id,
      metadata: {
        companyName: company.name,
        email: primaryEmail,
        title: contact.title,
        confidence: contact.confidence,
        verification: picked.result, // "deliverable" | "risky" | "unknown"
      },
    },
  });

  // Wire into active campaign immediately
  await autoEnqueueOutreach(newContact.id, companyId, company.fitProduct);
}
