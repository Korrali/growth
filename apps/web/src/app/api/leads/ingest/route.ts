import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leads/ingest — called by product apps when a visitor leaves an
// email on a free tool (pre-signup, pre-trial). Creates a Contact (+ Company
// for business domains) so the lead exists in the CRM with provenance.
//
// Deliberately does NOT enqueue outreach: free-tool leads already receive the
// product app's own drip sequence; enrolling them in a cold campaign on top
// would double-email them. They surface for win-back / segmentation instead.
//
// Body: { email, source?, product? }
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "pm.me", "aol.com",
  "live.com", "msn.com", "gmx.com", "yandex.com", "mail.com", "zoho.com",
]);

export async function POST(req: NextRequest) {
  const secret = process.env.GROWTH_INGEST_SECRET;
  if (!secret || req.headers.get("x-ingest-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { email?: string; source?: string; product?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }

  const domain = email.split("@")[1];
  let companyId: string | null = null;

  if (!FREEMAIL.has(domain)) {
    const company = await prisma.company.upsert({
      where: { domain },
      create: {
        name: domain,
        domain,
        website: `https://${domain}`,
        acquisitionSource: "free_tool_lead",
      },
      update: {},
    });
    companyId = company.id;
  }

  const contact = await prisma.contact.upsert({
    where: { email },
    create: {
      email,
      companyId,
      isBuyer: true, // self-selected: they used a product tool themselves
    },
    // Existing contact: only backfill a missing company link — never touch
    // suppression or verification state from this path.
    update: companyId ? { companyId } : {},
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "lead.ingested",
      entity: "Contact",
      entityId: contact.id,
      metadata: {
        email,
        source: body.source ?? "unknown",
        product: body.product ?? "unknown",
      },
    },
  });

  return NextResponse.json({ ok: true, contactId: contact.id });
}
