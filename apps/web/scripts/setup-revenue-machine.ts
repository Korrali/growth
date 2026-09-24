/**
 * Put Growth into "Revenue machine" mode. Idempotent — safe to re-run.
 *
 *   pnpm tsx scripts/setup-revenue-machine.ts --env /home/ec2-user/growth/.env.production [flags]
 *
 * Always:
 *  - creates (or updates) the one campaign "Revenue — marketplace install":
 *    4 steps, weekday 8:00–17:00 New York, 1 email per domain per day
 *  - pauses every other ACTIVE internal campaign (Trust included) so auto-enroll
 *    and sends go to Revenue only
 *
 * Flags:
 *  --daily <n>        daily send cap for the campaign (default 30; MAX_SENDS_PER_DAY
 *                     in the env stays the hard ceiling)
 *  --start            release the global emergency stop — real emails start going
 *                     out in the next weekday send window. Without it the stop is
 *                     set ON: leads still get scored, enrolled and their emails
 *                     written, so the drafts can be reviewed in Growth first.
 *  --keep-trust <n>   leave the newest Trust campaign ACTIVE instead of pausing
 *                     it. The daily count is global, so Trust only sends while
 *                     the day's total is below n.
 *
 * Test mode is deliberately never used: in test mode the sender advances every
 * outreach through all 4 steps without sending, which silently burns the list.
 */
import { readFileSync } from "fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

const CAMPAIGN_NAME = "Revenue — marketplace install";

// delayDays is measured from the previous step (sequence-scheduler.ts), so
// this runs day 0 → 3 → 7 → 14. subjectTemplate is a hint to the AI writer,
// which personalises every step per company; ctaType steers the ask.
const STEPS = [
  { stepNumber: 1, delayDays: 0, ctaType: "REPLY_QUESTION", subjectTemplate: "specific observation about their Stripe billing (no link in this email)" },
  { stepNumber: 2, delayDays: 3, ctaType: "SOFT_CLOSE", subjectTemplate: "one concrete leak type (e.g. failed renewals nobody retried) + free install link" },
  { stepNumber: 3, delayDays: 4, ctaType: "REPLY_QUESTION", subjectTemplate: "a different leak type (retired price / coupon that never expired) + uninstall-if-nothing offer" },
  { stepNumber: 4, delayDays: 7, ctaType: "BREAKUP", subjectTemplate: "short close-the-loop note, link once more" },
] as const;

async function main() {
  const envFile = arg("env");
  if (envFile) loadEnvFile(envFile);
  const daily = parseInt(arg("daily") ?? "30", 10);
  const keepTrust = arg("keep-trust");

  const { prisma } = await import("@/lib/db");

  const existing = await prisma.campaign.findFirst({
    where: { name: CAMPAIGN_NAME, clientId: null },
  });
  const settings = {
    product: "REVENUE" as const,
    status: "ACTIVE" as const,
    dailyLimit: daily,
    perDomainLimit: 1,
    sendWindowStart: 8,
    sendWindowEnd: 17,
    timezone: "America/New_York",
    maxFollowUps: 3,
    testMode: false,
  };
  const campaign = existing
    ? await prisma.campaign.update({ where: { id: existing.id }, data: settings })
    : await prisma.campaign.create({ data: { name: CAMPAIGN_NAME, ...settings } });

  for (const step of STEPS) {
    await prisma.sequenceStep.upsert({
      where: { campaignId_stepNumber: { campaignId: campaign.id, stepNumber: step.stepNumber } },
      create: { campaignId: campaign.id, ...step, bodyTemplate: "" },
      update: { delayDays: step.delayDays, ctaType: step.ctaType, subjectTemplate: step.subjectTemplate },
    });
  }

  const trustToKeep = keepTrust
    ? await prisma.campaign.findFirst({
        where: { product: "TRUST", status: "ACTIVE", clientId: null },
        orderBy: { createdAt: "desc" },
      })
    : null;
  if (trustToKeep) {
    await prisma.campaign.update({
      where: { id: trustToKeep.id },
      data: { dailyLimit: parseInt(keepTrust!, 10) },
    });
  }

  const paused = await prisma.campaign.updateMany({
    where: {
      status: "ACTIVE",
      clientId: null,
      id: { notIn: [campaign.id, ...(trustToKeep ? [trustToKeep.id] : [])] },
    },
    data: { status: "PAUSED" },
  });

  const stop = !flag("start");
  await prisma.growthSettings.upsert({
    where: { id: "global" },
    create: { id: "global", globalEmergencyStop: stop },
    update: { globalEmergencyStop: stop },
  });
  const global = await prisma.growthSettings.findUnique({ where: { id: "global" } });

  console.log(`campaign: ${campaign.name} (${campaign.id})`);
  console.log(`  ${campaign.dailyLimit}/day · weekdays 8:00–17:00 America/New_York`);
  console.log(`  env hard cap MAX_SENDS_PER_DAY=${process.env.MAX_SENDS_PER_DAY ?? "20 (default)"}`);
  console.log(`paused other campaigns: ${paused.count}`);
  if (trustToKeep) console.log(`kept Trust campaign "${trustToKeep.name}" at ${keepTrust}/day`);
  console.log(
    global?.globalEmergencyStop ?? true
      ? "global emergency stop: ON — drafts are written, nothing sends. Review them, then re-run with --start."
      : "global emergency stop: off — LIVE. Sends start in the next weekday window.",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
