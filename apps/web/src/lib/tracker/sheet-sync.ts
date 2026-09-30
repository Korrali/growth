import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

// Keeps the founder's distribution tracker (a Google Sheet) in step with cold
// outreach: one row per prospect and product, updated after each send and each
// reply. The sheet runs a small Apps Script web app (growth/docs/tracker-sheet.gs)
// that upserts rows by email + product and never overwrites a Status or Next
// step the founder has edited by hand.
//
// No-op unless TRACKER_WEBHOOK_URL and TRACKER_WEBHOOK_SECRET are set.

const PRODUCTS = { TRUST: "Trust", REVENUE: "Revenue" } as const;
const SNIPPET_CHARS = 300;

export interface TrackerRow {
  Name: string;
  Company: string;
  Product: string;
  Type: string;
  Source: string;
  Status: string;
  "Next step": string;
  Date: string;
  Email: string;
  "Emails sent": number;
  "Reply type": string;
  "Last reply": string;
}

type Category = "INTERESTED" | "NOT_NOW" | "WRONG_PERSON" | "OBJECTION" | "UNSUBSCRIBE" | "BOUNCE" | "AUTO_REPLY" | "NEGATIVE" | "OTHER";

export interface OutreachForTracker {
  status: string;
  nextSendAt: Date | null;
  stoppedReason: string | null;
  updatedAt: Date;
  product: string;
  contact: { email: string; firstName: string | null; lastName: string | null };
  companyName: string | null;
  messages: {
    direction: "OUTBOUND" | "INBOUND";
    sentAt: Date | null;
    bouncedAt: Date | null;
    createdAt: Date;
    body: string;
    classification: { category: Category; autoSendAt: Date | null; autoSentAt: Date | null; autoSendCancelledAt: Date | null } | null;
  }[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One tracker row for a prospect's outreach on one product. Several outreaches
 * (a re-send campaign, say) are merged by the caller before this is called.
 */
export function toTrackerRow(o: OutreachForTracker, now = new Date()): TrackerRow {
  const sent = o.messages.filter((m) => m.direction === "OUTBOUND" && m.sentAt);
  const bounced = o.messages.some((m) => m.direction === "OUTBOUND" && m.bouncedAt) || o.status === "BOUNCED";
  // Out-of-office and bounce notices are not replies. An inbound the classifier
  // hasn't reached yet is — the poller only keeps mail matched to our outreach.
  const replies = o.messages.filter(
    (m) => m.direction === "INBOUND" && !["AUTO_REPLY", "BOUNCE"].includes(m.classification?.category ?? ""),
  );
  const reply = replies.at(-1);
  const category = reply?.classification?.category;

  let status: string;
  let next: string;
  if (o.status === "UNSUBSCRIBED" || category === "UNSUBSCRIBE") {
    status = "Lost";
    next = "Unsubscribed. Don't contact again.";
  } else if (category === "NEGATIVE") {
    status = "Lost";
    next = "Said no.";
  } else if (reply) {
    status = "Replied";
    const c = reply.classification;
    if (!c) next = "Read their reply (not classified yet).";
    else if (category === "INTERESTED") {
      if (c.autoSentAt) next = `Interested. Reply sent ${day(c.autoSentAt)}; book the call.`;
      else if (c.autoSendAt && !c.autoSendCancelledAt && c.autoSendAt > now) next = `Interested. Drafted reply sends ${day(c.autoSendAt)} unless you cancel it in Growth.`;
      else next = "Interested. Reply and book the call.";
    } else if (category === "NOT_NOW") next = "Not now. Follow up later.";
    else if (category === "WRONG_PERSON") next = "Wrong person. Find the right contact.";
    else if (category === "OBJECTION") next = "Answer their objection.";
    else next = "Read their reply.";
  } else if (bounced) {
    status = "Lost";
    next = "Email bounced. Find another contact.";
  } else {
    status = "Contacted";
    if (["PENDING", "ACTIVE"].includes(o.status) && o.nextSendAt) next = `Next email due ${day(o.nextSendAt)}.`;
    else if (o.status === "COMPLETED") next = "Sequence finished, no reply.";
    else if (o.status === "STOPPED") next = `Stopped${o.stoppedReason ? ` (${o.stoppedReason.toLowerCase()})` : ""}.`;
    else next = "Waiting for a reply.";
  }

  const times = [...sent.map((m) => m.sentAt!), ...replies.map((m) => m.createdAt)];
  const last = times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : o.updatedAt;

  return {
    Name: [o.contact.firstName, o.contact.lastName].filter(Boolean).join(" "),
    Company: o.companyName ?? "",
    Product: PRODUCTS[o.product as keyof typeof PRODUCTS] ?? o.product,
    Type: "buyer",
    Source: "Growth cold email",
    Status: status,
    "Next step": next,
    Date: day(last),
    Email: o.contact.email,
    "Emails sent": sent.length,
    "Reply type": category ? category.toLowerCase().replace(/_/g, " ") : reply ? "unclassified" : "",
    "Last reply": reply ? reply.body.replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS) : "",
  };
}

/** Every Trust/Revenue prospect who has been sent at least one email. */
export async function buildTrackerRows(now = new Date()): Promise<TrackerRow[]> {
  const outreaches = await prisma.outreach.findMany({
    where: {
      campaign: { product: { in: ["TRUST", "REVENUE"] } },
      emailMessages: { some: { direction: "OUTBOUND", sentAt: { not: null } } },
    },
    select: {
      status: true,
      nextSendAt: true,
      stoppedReason: true,
      updatedAt: true,
      campaign: { select: { product: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
      company: { select: { name: true } },
      emailMessages: {
        orderBy: { createdAt: "asc" },
        select: {
          direction: true,
          sentAt: true,
          bouncedAt: true,
          createdAt: true,
          body: true,
          replyClassification: { select: { category: true, autoSendAt: true, autoSentAt: true, autoSendCancelledAt: true } },
        },
      },
    },
    orderBy: { updatedAt: "asc" },
  });

  // A prospect re-sent under a newer campaign for the same product is one row:
  // all their messages, with the most recently updated outreach's state.
  const merged = new Map<string, OutreachForTracker>();
  for (const o of outreaches) {
    const key = `${o.contact.email}|${o.campaign.product}`;
    const messages = o.emailMessages.map((m) => ({
      direction: m.direction,
      sentAt: m.sentAt,
      bouncedAt: m.bouncedAt,
      createdAt: m.createdAt,
      body: m.body,
      classification: m.replyClassification,
    }));
    const prev = merged.get(key);
    merged.set(key, {
      status: o.status,
      nextSendAt: o.nextSendAt,
      stoppedReason: o.stoppedReason,
      updatedAt: o.updatedAt,
      product: o.campaign.product,
      contact: o.contact,
      companyName: o.company?.name ?? prev?.companyName ?? null,
      messages: [...(prev?.messages ?? []), ...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    });
  }
  return [...merged.values()].map((o) => toTrackerRow(o, now));
}

// What the sheet last accepted, so an unchanged pipeline costs no request.
let lastPushedHash: string | null = null;

export async function syncTracker(): Promise<{ skipped?: string; rows?: number; updated?: number; appended?: number }> {
  const url = process.env.TRACKER_WEBHOOK_URL;
  const secret = process.env.TRACKER_WEBHOOK_SECRET;
  if (!url || !secret) return { skipped: "not configured" };

  const rows = await buildTrackerRows();
  const hash = createHash("sha1").update(JSON.stringify(rows)).digest("hex");
  if (hash === lastPushedHash) return { skipped: "unchanged" };

  // Apps Script answers a POST with a redirect to the result; fetch follows it.
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, rows }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body: { ok?: boolean; error?: string; updated?: number; appended?: number };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`tracker sheet answered ${res.status} with non-JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok || !body.ok) throw new Error(`tracker sheet rejected the sync: ${body.error ?? res.status}`);

  lastPushedHash = hash;
  return { rows: rows.length, updated: body.updated, appended: body.appended };
}
