import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MARKETED_PRODUCT_KEYS, type MarketedProduct } from "@/lib/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/trials/ingest — called by the product apps (Trust, Revenue, …)
// when an org signs up or hits an activation milestone, so Growth can run
// trial nurture + win-back. Authenticated via shared secret header.
//
// Body: {
//   product, externalOrgId, companyName, contactEmail,        (create)
//   trialStartedAt?, trialEndsAt?, source?,
//   signals?: { hasKbFacts?, hasAnsweredQ?, hasTrustPage?,    (update)
//               hasStripeConnected?, hasSeenAnomaly? }
// }
export async function POST(req: NextRequest) {
  const secret = process.env.GROWTH_INGEST_SECRET;
  if (!secret || req.headers.get("x-ingest-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    product?: string;
    externalOrgId?: string;
    companyName?: string;
    contactEmail?: string;
    trialStartedAt?: string;
    trialEndsAt?: string;
    source?: string;
    signals?: Record<string, boolean>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const product = body.product?.toUpperCase();
  if (!product || !MARKETED_PRODUCT_KEYS.includes(product as MarketedProduct)) {
    return NextResponse.json({ error: "invalid product" }, { status: 400 });
  }
  if (!body.externalOrgId) {
    return NextResponse.json({ error: "externalOrgId required" }, { status: 400 });
  }

  const ALLOWED_SIGNALS = new Set([
    "hasLogin", "hasKbFacts", "hasAnsweredQ", "hasTrustPage",
    "hasStripeConnected", "hasSeenAnomaly",
  ]);
  const signalData: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(body.signals ?? {})) {
    if (ALLOWED_SIGNALS.has(k) && typeof v === "boolean") signalData[k] = v;
  }

  const existing = await prisma.trial.findFirst({
    where: { product: product as MarketedProduct, externalOrgId: body.externalOrgId },
  });

  if (existing) {
    const updated = await prisma.trial.update({
      where: { id: existing.id },
      data: {
        ...signalData,
        ...(body.companyName ? { companyName: body.companyName } : {}),
        ...(body.contactEmail ? { contactEmail: body.contactEmail } : {}),
      },
    });
    return NextResponse.json({ ok: true, trialId: updated.id, created: false });
  }

  if (!body.companyName || !body.contactEmail) {
    return NextResponse.json(
      { error: "companyName and contactEmail required to create a trial" },
      { status: 400 },
    );
  }

  const now = new Date();
  const trial = await prisma.trial.create({
    data: {
      product: product as MarketedProduct,
      externalOrgId: body.externalOrgId,
      companyName: body.companyName,
      contactEmail: body.contactEmail,
      trialStartedAt: body.trialStartedAt ? new Date(body.trialStartedAt) : now,
      trialEndsAt: body.trialEndsAt
        ? new Date(body.trialEndsAt)
        : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      acquisitionSource: body.source ?? "product_signup",
      status: "ACTIVE",
      hasLogin: true, // they just signed up
      ...signalData,
    },
  });

  return NextResponse.json({ ok: true, trialId: trial.id, created: true });
}
