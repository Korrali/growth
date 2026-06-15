import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import Stripe from "stripe";

export const runtime = "nodejs";

// Stripe signs webhooks with HMAC-SHA256; we verify before processing.
async function verifyStripeSignature(req: NextRequest): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) throw new Error("Missing stripe-signature header");

  return stripe.webhooks.constructEvent(body, sig, secret);
}

async function sendPaymentNotification(client: { name: string; contactEmail: string }, amountPaid: number, invoiceUrl: string | null) {
  const founderEmail = process.env.FOUNDER_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  if (!founderEmail || !resendKey) return;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "growth@korrali.com",
      to: founderEmail,
      subject: `💰 Payment received — ${client.name} ($${(amountPaid / 100).toLocaleString()})`,
      text: [
        `Client: ${client.name} (${client.contactEmail})`,
        `Amount paid: $${(amountPaid / 100).toLocaleString()}`,
        invoiceUrl ? `Invoice: ${invoiceUrl}` : "",
        ``,
        `View client: https://growth.korrali.com/growth/clients`,
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  });
}

export async function POST(req: NextRequest) {
  let event: Stripe.Event;
  try {
    event = await verifyStripeSignature(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.productType === "growth_service_self_serve") {
      const customerEmail = session.metadata.customerEmail || session.customer_email || "";
      const customerName  = session.metadata.customerName  || customerEmail.split("@")[0];
      const stripeCustomerId    = typeof session.customer    === "string" ? session.customer    : null;
      const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : null;

      // Only create if not already exists (idempotency)
      const existing = await prisma.client.findUnique({ where: { contactEmail: customerEmail } });
      if (!existing && customerEmail) {
        await prisma.client.create({
          data: {
            name:                customerName,
            contactEmail:        customerEmail,
            plan:                "SELF_SERVE",
            status:              "ACTIVE",
            fromName:            process.env.GROWTH_FROM_NAME ?? "Ashish from Korrali",
            fromEmail:           process.env.GROWTH_FROM_EMAIL ?? "outreach@korrali.com",
            icpProfile:          "B2B SaaS founders, 2–20 employees, bootstrapped or seed-stage, no dedicated sales hire.",
            monthlyFeeUsd:       300,
            // replyForwardTo lives on Campaign — admin sets it when creating the first campaign for this client
            stripeCustomerId,
            stripeSubscriptionId,
          },
        });

        // Notify founder
        const resendKey = process.env.RESEND_API_KEY;
        const founderEmail = process.env.FOUNDER_EMAIL;
        if (resendKey && founderEmail) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM ?? "growth@korrali.com",
              to: founderEmail,
              subject: `🎉 New self-serve client — ${customerName} ($300/mo)`,
              text: [
                `New self-serve Growth client signed up:`,
                ``,
                `Name:  ${customerName}`,
                `Email: ${customerEmail}`,
                ``,
                `Action required: set up their first campaign at`,
                `https://growth.korrali.com/growth/clients`,
              ].join("\n"),
            }),
          }).catch(() => {});
        }
      }
    }
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const growthClientId = invoice.metadata?.growthClientId;

    if (!customerId && !growthClientId) {
      return NextResponse.json({ received: true });
    }

    // Find the client by Stripe customer ID or by our metadata
    const client = await prisma.client.findFirst({
      where: growthClientId
        ? { id: growthClientId }
        : { stripeCustomerId: customerId ?? undefined },
    });

    if (client) {
      // Persist stripeCustomerId if not already set
      if (!client.stripeCustomerId && customerId) {
        await prisma.client.update({
          where: { id: client.id },
          data: { stripeCustomerId: customerId },
        });
      }

      // Fire-and-forget notification — don't let email failure block 200 response
      sendPaymentNotification(
        client,
        invoice.amount_paid,
        invoice.hosted_invoice_url ?? null,
      ).catch(() => {});
    }
  }

  return NextResponse.json({ received: true });
}
