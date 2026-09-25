import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail/transport";
import { globalDailyCap } from "@/lib/sending/send-budget";

// The founder's morning sheet. One email, same shape every day: what went
// out, who wrote back, what needs a human today, and anything broken. The
// point is that the founder never has to open Growth to know whether the
// machine ran — the email arriving IS the heartbeat, and its warnings say
// exactly what to fix.

const DAY_MS = 24 * 60 * 60 * 1000;
const NEEDS_FOUNDER = ["INTERESTED", "OBJECTION", "NOT_NOW", "WRONG_PERSON", "OTHER"] as const;
const LOW_FUEL_DAYS = 5;
const BOUNCE_ALARM_RATE = 0.03;
// Above this, the digest pulls the emergency stop itself: a list that bounces
// this much is damaging the sending domain faster than a human would notice.
const BOUNCE_BRAKE_RATE = 0.05;
const BOUNCE_BRAKE_MIN_SENDS = 20;

export interface DigestData {
  sent: number;
  sentByCampaign: { name: string; count: number }[];
  replies: { category: string; count: number }[];
  needsYou: {
    category: string;
    name: string;
    company: string;
    email: string;
    snippet: string;
    autoSendAt: Date | null;
    autoSent: boolean;
  }[];
  bounces: number;
  queued: number;
  /** Buyer contacts whose company is still waiting to be scored. */
  awaitingResearch: number;
  /** Everyone who got their FIRST email in the window — connect on LinkedIn. */
  emailed: { name: string; title: string; company: string; linkedinUrl: string | null; product: string }[];
  dailyCap: number;
  activeCampaigns: string[];
  emergencyStop: boolean;
  totals: { sent: number; replied: number; interested: number };
  /** Set when this digest run pulled the emergency stop (bounce brake). */
  autoPaused?: boolean;
}

/**
 * Prospects who have not had their first email yet: enrolled-but-unsent plus
 * sendable buyer contacts at qualifying companies that auto-enroll has not
 * reached. This is the number that tells the founder when to pull a new list.
 */
async function countFuel(): Promise<number> {
  const [enrolledUnsent, notYetEnrolled] = await Promise.all([
    prisma.outreach.count({
      where: { status: { in: ["PENDING", "ACTIVE"] }, emailMessages: { none: { direction: "OUTBOUND" } } },
    }),
    prisma.contact.count({
      where: {
        isBuyer: true,
        suppressedAt: null,
        emailStatus: { notIn: ["INVALID", "DISPOSABLE"] },
        outreaches: { none: {} },
        company: { fitScore: { gte: 6 }, fitProduct: { in: ["REVENUE", "BOTH", "TRUST"] } },
      },
    }),
  ]);
  return enrolledUnsent + notYetEnrolled;
}

/**
 * Buyer contacts whose company hasn't been scored yet. Imports queue scoring a
 * few companies an hour (free AI tiers), so right after an import most of the
 * list sits here — without counting them the digest cried "list running dry"
 * with ~1,300 leads still in the pipe.
 */
async function countAwaitingResearch(): Promise<number> {
  return prisma.contact.count({
    where: {
      isBuyer: true,
      suppressedAt: null,
      outreaches: { none: {} },
      company: { fitScoredAt: null },
    },
  });
}

export async function collectDigest(now = new Date()): Promise<DigestData> {
  const since = new Date(now.getTime() - DAY_MS);

  const [outbound, inbound, settings, campaigns, queued, totalsSent, totalsReplied, totalsInterested, awaitingResearch] =
    await Promise.all([
      prisma.emailMessage.findMany({
        where: { direction: "OUTBOUND", sentAt: { gte: since }, stepNumber: { not: null } },
        select: {
          stepNumber: true,
          contact: { select: { firstName: true, lastName: true, email: true, title: true, linkedinUrl: true, company: { select: { name: true } } } },
          outreach: { select: { campaign: { select: { name: true, product: true } } } },
        },
        orderBy: { sentAt: "asc" },
      }),
      prisma.emailMessage.findMany({
        where: { direction: "INBOUND", createdAt: { gte: since } },
        include: { contact: { include: { company: true } }, replyClassification: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.growthSettings.findUnique({ where: { id: "global" } }),
      prisma.campaign.findMany({
        where: { status: "ACTIVE", clientId: null },
        select: { name: true, dailyLimit: true },
      }),
      countFuel(),
      prisma.emailMessage.count({ where: { direction: "OUTBOUND", stepNumber: { not: null } } }),
      prisma.outreach.count({ where: { status: "REPLIED" } }),
      prisma.replyClassification.count({ where: { category: "INTERESTED" } }),
      countAwaitingResearch(),
    ]);

  // First-touch sends only: follow-ups go to people already on this list.
  const emailed = outbound
    .filter((m) => m.stepNumber === 1)
    .map((m) => ({
      name: [m.contact.firstName, m.contact.lastName].filter(Boolean).join(" ") || m.contact.email,
      title: m.contact.title ?? "",
      company: m.contact.company?.name ?? "",
      linkedinUrl: m.contact.linkedinUrl,
      product: m.outreach?.campaign.product === "TRUST" ? "Trust" : "Revenue",
    }));

  const byCampaign = new Map<string, number>();
  for (const m of outbound) {
    const name = m.outreach?.campaign.name ?? "(no campaign)";
    byCampaign.set(name, (byCampaign.get(name) ?? 0) + 1);
  }

  const byCategory = new Map<string, number>();
  let bounces = 0;
  const needsYou: DigestData["needsYou"] = [];
  for (const m of inbound) {
    if (m.bouncedAt) {
      bounces += 1;
      continue;
    }
    const category = m.replyClassification?.category ?? "UNCLASSIFIED";
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    if ((NEEDS_FOUNDER as readonly string[]).includes(category) || category === "UNCLASSIFIED") {
      needsYou.push({
        category,
        name: [m.contact.firstName, m.contact.lastName].filter(Boolean).join(" ") || m.contact.email,
        company: m.contact.company?.name ?? "",
        email: m.contact.email,
        snippet: m.body.replace(/\s+/g, " ").slice(0, 240),
        autoSendAt: m.replyClassification?.autoSendAt ?? null,
        autoSent: !!m.replyClassification?.autoSentAt,
      });
    }
  }


  return {
    sent: outbound.length,
    sentByCampaign: [...byCampaign].map(([name, count]) => ({ name, count })),
    replies: [...byCategory].map(([category, count]) => ({ category, count })),
    needsYou,
    bounces,
    queued,
    awaitingResearch,
    emailed,
    dailyCap: await globalDailyCap(now),
    activeCampaigns: campaigns.map((c) => c.name),
    emergencyStop: settings?.globalEmergencyStop ?? true,
    totals: { sent: totalsSent, replied: totalsReplied, interested: totalsInterested },
  };
}

export function shouldBrake(d: DigestData): boolean {
  return !d.emergencyStop && d.sent >= BOUNCE_BRAKE_MIN_SENDS && d.bounces / d.sent > BOUNCE_BRAKE_RATE;
}

export function digestWarnings(d: DigestData, now = new Date()): string[] {
  const warnings: string[] = [];
  if (d.autoPaused) {
    warnings.push(`AUTO-PAUSED: bounce rate ${(100 * d.bounces / d.sent).toFixed(1)}% in the last 24h. The emergency stop is ON. Clean the list, then re-run setup with --start.`);
  }
  const weekday = now.getUTCDay() !== 0 && now.getUTCDay() !== 1; // covers Mon–Fri US sends
  if (d.emergencyStop && !d.autoPaused) warnings.push("Emergency stop is ON — nothing is sending. Turn it off in Growth → Settings.");
  if (d.activeCampaigns.length === 0) warnings.push("No ACTIVE campaign — nothing can send or enroll.");
  if (!d.emergencyStop && d.activeCampaigns.length > 0 && d.sent === 0 && weekday) {
    warnings.push("Zero emails sent in the last 24h on a weekday. Check the worker (pm2 logs growth-worker-prod) and mailbox credentials.");
  }
  if (d.sent > 0 && d.bounces / d.sent > BOUNCE_ALARM_RATE) {
    warnings.push(`Bounce rate ${(100 * d.bounces / d.sent).toFixed(1)}% (> 3%). Pause and clean the list before sending more — this damages the domain.`);
  }
  const fuel = d.queued + d.awaitingResearch;
  if (d.dailyCap > 0 && fuel / d.dailyCap < LOW_FUEL_DAYS) {
    warnings.push(`Only ${fuel} prospects left to start (~${Math.floor(fuel / d.dailyCap)} days at ${d.dailyCap}/day). Pull the next Apollo batch and import it.`);
  }
  return warnings;
}

export function renderDigest(d: DigestData, now = new Date()): { subject: string; text: string } {
  const warnings = digestWarnings(d, now);
  const interested = d.needsYou.filter((n) => n.category === "INTERESTED").length;
  const date = now.toISOString().slice(0, 10);
  const subject = `${warnings.length ? "⚠ " : ""}Growth ${date}: ${d.sent} sent · ${d.needsYou.length} need you${interested ? ` · ${interested} interested` : ""}`;

  const lines: string[] = [];
  if (warnings.length) {
    lines.push("FIX FIRST", ...warnings.map((w) => `  ! ${w}`), "");
  }

  lines.push("NEEDS YOU TODAY");
  if (d.needsYou.length === 0) lines.push("  Nothing. Go do your LinkedIn block.");
  for (const n of d.needsYou) {
    const auto = n.category === "INTERESTED"
      ? n.autoSent ? " [auto-reply sent]" : n.autoSendAt ? ` [auto-reply queued ${n.autoSendAt.toISOString().slice(11, 16)} UTC]` : ""
      : "";
    lines.push(`  [${n.category}] ${n.name}${n.company ? ` — ${n.company}` : ""} <${n.email}>${auto}`);
    lines.push(`      "${n.snippet}"`);
  }
  lines.push("");

  lines.push(`EMAILED FOR THE FIRST TIME — connect on LinkedIn (${d.emailed.length})`);
  if (d.emailed.length === 0) lines.push("  Nobody new in the last 24 hours.");
  for (const e of d.emailed) {
    lines.push(`  [${e.product}] ${e.name}${e.title ? `, ${e.title}` : ""}${e.company ? ` — ${e.company}` : ""}`);
    lines.push(`      ${e.linkedinUrl ?? "(no LinkedIn URL)"}`);
  }
  lines.push("");

  lines.push("LAST 24 HOURS");
  lines.push(`  Sent: ${d.sent}${d.sentByCampaign.length ? ` (${d.sentByCampaign.map((c) => `${c.name}: ${c.count}`).join(", ")})` : ""}`);
  lines.push(`  Replies: ${d.replies.length ? d.replies.map((r) => `${r.category} ${r.count}`).join(", ") : "none"}`);
  lines.push(`  Bounces: ${d.bounces}`);
  lines.push("");

  lines.push("PIPELINE");
  lines.push(`  Prospects waiting for their first email: ${d.queued + d.awaitingResearch} (${d.queued} ready · ${d.awaitingResearch} still being researched) · cap ${d.dailyCap}/day`);
  lines.push(`  Active campaigns: ${d.activeCampaigns.join(", ") || "none"}`);
  lines.push(`  All time: ${d.totals.sent} cold emails · ${d.totals.replied} replied · ${d.totals.interested} interested`);
  lines.push("");

  lines.push("YOUR PART (optional — the machine runs without it)");
  lines.push("  - INTERESTED replies already get the AI answer with the link after 2h. Reply yourself first if you want.");
  lines.push("  - Objections / not now / wrong person: answer if you like.");
  lines.push("  - Anyone who installed or started a trial: offer a 15-minute walkthrough.");
  lines.push("  - LinkedIn: connect with everyone under EMAILED above (drafts are in Growth → LinkedIn).");
  lines.push("");
  return { subject, text: lines.join("\n") };
}

export async function sendDailyDigest(now = new Date()): Promise<void> {
  const founder = process.env.FOUNDER_EMAIL;
  if (!founder) return;
  const data = await collectDigest(now);
  if (shouldBrake(data)) {
    await prisma.growthSettings.upsert({
      where: { id: "global" },
      create: { id: "global", globalEmergencyStop: true },
      update: { globalEmergencyStop: true },
    });
    data.emergencyStop = true;
    data.autoPaused = true;
  }
  const { subject, text } = renderDigest(data, now);
  await sendMail({
    from: process.env.EMAIL_FROM ?? "growth@korrali.com",
    to: founder,
    subject,
    text,
  });
}
