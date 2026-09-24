import { prisma } from "@/lib/db";

// How many cold emails may go out today, in total and per campaign.
//
// Total: a warm-up schedule, so a mailbox that has barely sent cold mail is
// not asked for 80 a day on day one, and nobody has to remember to raise the
// limit later. It starts at WARMUP_START on the day of the first mailbox send
// and grows by WARMUP_STEP each week, up to SEND_CAP_CEILING (env, default 80).
//
// Per campaign: each ACTIVE internal campaign gets a share of the total in
// proportion to its dailyLimit, which acts as a weight. Revenue 60 + Trust 40
// means 60/40 of whatever the total is that day — both products always send,
// and neither can starve the other by being first in the queue.
//
// Only cold sequence steps count (stepNumber set). Auto-replies to interested
// prospects and founder alerts never use the budget.

export const WARMUP_START = 30;
export const WARMUP_STEP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function sendCapCeiling(): number {
  const v = parseInt(process.env.SEND_CAP_CEILING ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 80;
}

export function warmupCap(firstSendAt: Date | null, now: Date, ceiling = sendCapCeiling()): number {
  const weeks = firstSendAt ? Math.floor((now.getTime() - firstSendAt.getTime()) / (7 * DAY_MS)) : 0;
  return Math.min(ceiling, WARMUP_START + WARMUP_STEP * Math.max(0, weeks));
}

export function campaignShare(globalCap: number, weight: number, totalWeight: number): number {
  if (totalWeight <= 0 || weight <= 0) return 0;
  return Math.max(1, Math.floor((globalCap * weight) / totalWeight));
}

function todayStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Total cold sends allowed today (warm-up schedule). */
export async function globalDailyCap(now = new Date()): Promise<number> {
  // The schedule starts with the first send through the Workspace mailbox
  // (those rows carry an rfcMessageId); Resend-era history doesn't warm it.
  const first = await prisma.emailMessage.findFirst({
    where: { direction: "OUTBOUND", stepNumber: { not: null }, rfcMessageId: { not: null } },
    orderBy: { sentAt: "asc" },
    select: { sentAt: true },
  });
  return warmupCap(first?.sentAt ?? null, now);
}

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
}

export async function checkSendBudget(campaignId: string, now = new Date()): Promise<BudgetCheck> {
  const since = todayStart(now);
  const [cap, campaigns, sentTotal, sentCampaign] = await Promise.all([
    globalDailyCap(now),
    prisma.campaign.findMany({
      where: { status: "ACTIVE", clientId: null },
      select: { id: true, dailyLimit: true },
    }),
    prisma.emailMessage.count({
      where: { direction: "OUTBOUND", stepNumber: { not: null }, sentAt: { gte: since } },
    }),
    prisma.emailMessage.count({
      where: {
        direction: "OUTBOUND",
        stepNumber: { not: null },
        sentAt: { gte: since },
        outreach: { campaignId },
      },
    }),
  ]);

  if (sentTotal >= cap) return { allowed: false, reason: `daily_limit_reached:total:${sentTotal}/${cap}` };

  const totalWeight = campaigns.reduce((sum, c) => sum + c.dailyLimit, 0);
  const weight = campaigns.find((c) => c.id === campaignId)?.dailyLimit ?? 0;
  const share = campaignShare(cap, weight, totalWeight);
  if (sentCampaign >= share) {
    return { allowed: false, reason: `daily_limit_reached:campaign:${sentCampaign}/${share}` };
  }
  return { allowed: true };
}
