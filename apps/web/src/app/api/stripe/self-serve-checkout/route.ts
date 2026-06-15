import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

const SELF_SERVE_PRICE_ID = process.env.STRIPE_PRICE_SELF_SERVE_MONTHLY;
const APP_URL = process.env.APP_URL ?? "https://growth.korrali.com";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const priceId = SELF_SERVE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "Self-serve pricing not yet configured" }, { status: 503 });
  }

  const { name, email } = (await req.json()) as { name?: string; email?: string };
  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email.trim().toLowerCase(),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/growth-service/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/growth-service`,
    metadata: {
      productType: "growth_service_self_serve",
      customerName: (name ?? "").trim(),
      customerEmail: email.trim().toLowerCase(),
    },
    subscription_data: {
      metadata: {
        productType: "growth_service_self_serve",
        customerName: (name ?? "").trim(),
        customerEmail: email.trim().toLowerCase(),
      },
    },
  });

  return NextResponse.json({ url: session.url });
}
