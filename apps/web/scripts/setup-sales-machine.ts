/**
 * Put Growth into sales-machine mode: one Revenue and one Trust campaign, both
 * ACTIVE, everything else paused. Idempotent — safe to re-run.
 *
 *   pnpm tsx scripts/setup-sales-machine.ts --env /home/ec2-user/growth/.env.production [flags]
 *
 * Volume is automatic (src/lib/sending/send-budget.ts): the day's total follows
 * a warm-up schedule (30/day, +10 a week, up to SEND_CAP_CEILING), and each
 * campaign gets a share of it by weight.
 *
 * Flags:
 *  --start               release the global emergency stop — real emails go out
 *                        in the next weekday send window. Without it the stop is
 *                        set ON: leads are still scored, enrolled and their emails
 *                        written, so drafts can be reviewed first.
 *  --revenue-weight <n>  share weight for Revenue (default 60)
 *  --trust-weight <n>    share weight for Trust (default 40; 0 pauses Trust)
 *
 * Test mode is never used: it advances every outreach through all 4 steps
 * without sending, which silently burns the list.
 */
import { readFileSync } from "fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

type Step = { stepNumber: number; delayDays: number; ctaType: "REPLY_QUESTION" | "SOFT_CLOSE" | "BREAKUP"; subjectTemplate: string };

// delayDays is measured from the previous step (sequence-scheduler.ts): day
// 0 → 3 → 7 → 14. subjectTemplate is a hint to the AI writer, which
// personalises every step per company; ctaType steers the ask.
const CAMPAIGNS: { product: "REVENUE" | "TRUST"; name: string; weightFlag: string; defaultWeight: number; steps: Step[] }[] = [
  {
    product: "REVENUE",
    name: "Revenue — marketplace install",
    weightFlag: "revenue-weight",
    defaultWeight: 60,
    steps: [
      { stepNumber: 1, delayDays: 0, ctaType: "REPLY_QUESTION", subjectTemplate: "specific observation about their Stripe billing (no link in this email)" },
      { stepNumber: 2, delayDays: 3, ctaType: "SOFT_CLOSE", subjectTemplate: "one concrete leak type (e.g. failed renewals nobody retried) + free install link" },
      { stepNumber: 3, delayDays: 4, ctaType: "REPLY_QUESTION", subjectTemplate: "a different leak type (retired price / coupon that never expired) + uninstall-if-nothing offer" },
      { stepNumber: 4, delayDays: 7, ctaType: "BREAKUP", subjectTemplate: "short close-the-loop note, link once more" },
    ],
  },
  {
    product: "TRUST",
    name: "Trust — questionnaire trial",
    weightFlag: "trust-weight",
    defaultWeight: 40,
    steps: [
      { stepNumber: 1, delayDays: 0, ctaType: "REPLY_QUESTION", subjectTemplate: "who answers their enterprise security questionnaires today (no link in this email)" },
      { stepNumber: 2, delayDays: 3, ctaType: "SOFT_CLOSE", subjectTemplate: "the AI section now showing up in security reviews + free trial link" },
      { stepNumber: 3, delayDays: 4, ctaType: "REPLY_QUESTION", subjectTemplate: "cited draft answers back in their original spreadsheet + try it on the next one due" },
      { stepNumber: 4, delayDays: 7, ctaType: "BREAKUP", subjectTemplate: "short close-the-loop note, link once more" },
    ],
  },
];

async function main() {
  const envFile = arg("env");
  if (envFile) loadEnvFile(envFile);
  const { prisma } = await import("@/lib/db");
  const { globalDailyCap, campaignShare } = await import("@/lib/sending/send-budget");

  const keep: string[] = [];
  const summary: { name: string; weight: number; id: string }[] = [];

  for (const c of CAMPAIGNS) {
    const weight = parseInt(arg(c.weightFlag) ?? String(c.defaultWeight), 10);
    const settings = {
      product: c.product,
      status: weight > 0 ? ("ACTIVE" as const) : ("PAUSED" as const),
      dailyLimit: Math.max(weight, 1), // acts as the campaign's share weight
      perDomainLimit: 1,
      sendWindowStart: 8,
      sendWindowEnd: 17,
      timezone: "America/New_York",
      maxFollowUps: 3,
      testMode: false,
    };
    const existing = await prisma.campaign.findFirst({ where: { name: c.name, clientId: null } });
    const campaign = existing
      ? await prisma.campaign.update({ where: { id: existing.id }, data: settings })
      : await prisma.campaign.create({ data: { name: c.name, ...settings } });

    for (const step of c.steps) {
      await prisma.sequenceStep.upsert({
        where: { campaignId_stepNumber: { campaignId: campaign.id, stepNumber: step.stepNumber } },
        create: { campaignId: campaign.id, ...step, bodyTemplate: "" },
        update: { delayDays: step.delayDays, ctaType: step.ctaType, subjectTemplate: step.subjectTemplate },
      });
    }
    if (weight > 0) {
      keep.push(campaign.id);
      summary.push({ name: c.name, weight, id: campaign.id });
    }
  }

  const paused = await prisma.campaign.updateMany({
    where: { status: "ACTIVE", clientId: null, id: { notIn: keep } },
    data: { status: "PAUSED" },
  });

  const stop = !process.argv.includes("--start");
  await prisma.growthSettings.upsert({
    where: { id: "global" },
    create: { id: "global", globalEmergencyStop: stop },
    update: { globalEmergencyStop: stop },
  });

  const cap = await globalDailyCap();
  const totalWeight = summary.reduce((s, c) => s + c.weight, 0);
  console.log(`today's total: ${cap}/day (warm-up: 30, +10 a week, up to SEND_CAP_CEILING)`);
  for (const c of summary) {
    console.log(`ACTIVE  ${c.name} — ${campaignShare(cap, c.weight, totalWeight)}/day today (weight ${c.weight})`);
  }
  console.log(`paused other campaigns: ${paused.count}`);
  console.log(
    stop
      ? "emergency stop: ON — emails are written, nothing sends. Re-run with --start to go live."
      : "emergency stop: off — LIVE. Sends start in the next weekday window (8:00–17:00 New York).",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
