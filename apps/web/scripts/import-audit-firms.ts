/**
 * Import the audit-firm list into Growth as an AUDITOR campaign: a fixed
 * partnership offer to CPA firms (templates.ts buildAuditFirmSequence).
 *
 *   pnpm tsx scripts/import-audit-firms.ts --file scripts/data/audit-firms.csv \
 *     --env /home/ec2-user/growth/.env.production --batch2-at 2026-10-13T13:00:00Z \
 *     [--weight 20] [--dry-run]
 *
 * Creates (or reuses) the campaign "Trust: audit firm partners" — status
 * DRAFT, two steps (the offer, then one follow-up 5 days later) — and enrolls
 * every firm into it. Batch 1 is due at once; batch 2 is due at --batch2-at.
 * A firm Growth has already written to (a contact on its domain, or the same
 * email) is skipped, never re-enrolled. A company row with no contacts — one
 * the discovery pipeline found and scored as not a product buyer — is reused.
 * Nothing sends until the campaign is set ACTIVE. Safe to re-run.
 *
 * --weight is the campaign's dailyLimit: its share of the day's send cap
 * relative to the other active campaigns (send-budget.ts).
 */
import { readFileSync } from "fs";
import { basename } from "path";

const CAMPAIGN_NAME = "Trust: audit firm partners";
const FOLLOW_UP_DELAY_DAYS = 5;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file is required");
  const batch2Raw = arg("batch2-at");
  if (!batch2Raw) throw new Error("--batch2-at is required (ISO time batch 2 becomes due)");
  const batch2At = new Date(batch2Raw);
  if (Number.isNaN(batch2At.getTime())) throw new Error(`--batch2-at is not a date: ${batch2Raw}`);
  const weight = Math.max(1, parseInt(arg("weight", "20")!, 10));
  const dryRun = process.argv.includes("--dry-run");
  const envFile = arg("env");
  if (envFile) loadEnvFile(envFile);

  // Imported after the env is loaded: db.ts reads it on first use.
  const { parseAuditFirmsCsv } = await import("@/lib/import/audit-firms");
  const { timezoneForCountry } = await import("@/lib/sending/timezone");
  const { prisma } = await import("@/lib/db");

  const { leads, skipped } = parseAuditFirmsCsv(readFileSync(file, "utf8"));
  console.log(`file: ${basename(file)}`);
  console.log(`firms: ${leads.length} (batch 1: ${leads.filter((l) => l.batch === 1).length}, batch 2: ${leads.filter((l) => l.batch === 2).length})`);
  console.log(`batch 2 due: ${batch2At.toISOString()}`);
  for (const s of skipped) console.log(`  skipped row ${s.row} ${s.firm}: ${s.reason}`);

  // Already in Growth: a firm with a contact on file is left alone.
  const known: string[] = [];
  const reused: string[] = [];
  const fresh = [];
  for (const lead of leads) {
    const [company, contact] = await Promise.all([
      prisma.company.findUnique({ where: { domain: lead.domain }, select: { id: true, _count: { select: { contacts: true } } } }),
      prisma.contact.findUnique({ where: { email: lead.email }, select: { id: true } }),
    ]);
    if (contact || (company && company._count.contacts > 0)) {
      known.push(`${lead.firm} (${lead.email})`);
      continue;
    }
    if (company) reused.push(lead.firm);
    fresh.push(lead);
  }
  console.log(`to enrol: ${fresh.length}`);
  if (reused.length) console.log(`company row already in Growth with no contacts, reused: ${reused.join("; ")}`);
  if (known.length) console.log(`already contacted through Growth, skipped: ${known.join("; ")}`);

  if (dryRun) {
    for (const l of fresh) console.log(`  [batch ${l.batch}] ${l.firm} · ${l.email} · ${l.firstName ?? "(no name)"} · ${l.country ?? ""}`);
    console.log("dry run — nothing written");
    await prisma.$disconnect();
    return;
  }

  let campaign = await prisma.campaign.findFirst({
    where: { name: CAMPAIGN_NAME, product: "TRUST", audience: "AUDITOR", clientId: null },
  });
  if (!campaign) {
    const direct = await prisma.campaign.findFirst({
      where: { product: "TRUST", status: "ACTIVE", clientId: null, audience: "DIRECT" },
    });
    if (!direct) throw new Error("no ACTIVE Trust campaign to copy the send window from");
    campaign = await prisma.campaign.create({
      data: {
        name: CAMPAIGN_NAME,
        product: "TRUST",
        audience: "AUDITOR",
        status: "DRAFT",
        testMode: false,
        dailyLimit: weight,
        perDomainLimit: 1,
        sendWindowStart: direct.sendWindowStart,
        sendWindowEnd: direct.sendWindowEnd,
        timezone: direct.timezone,
        maxFollowUps: 1,
        // Bodies come from templates.ts buildAuditFirmSequence; these rows carry the delays.
        sequenceSteps: {
          create: [0, FOLLOW_UP_DELAY_DAYS].map((delayDays, i) => ({
            stepNumber: i + 1,
            delayDays,
            subjectTemplate: "(templates.ts buildAuditFirmSequence)",
            bodyTemplate: "(templates.ts buildAuditFirmSequence)",
            ctaType: "REPLY_QUESTION" as const,
          })),
        },
      },
    });
    console.log(`created AUDITOR campaign ${campaign.id} (DRAFT, weight ${weight})`);
  } else {
    console.log(`using AUDITOR campaign ${campaign.id} (${campaign.status}, weight ${campaign.dailyLimit})`);
  }

  const source = `audit-firms:${basename(file)}`;
  const now = Date.now();
  let enrolled = 0;
  for (const lead of fresh) {
    // Not AI-scored: the send gate needs >= 6 and the product ICP rejects service firms.
    const fit = {
      name: lead.firm,
      fitProduct: "TRUST" as const,
      fitScore: 7,
      fitScoredAt: new Date(),
      fitReasoning: `Hand-picked audit firm for AUDITOR campaign "${CAMPAIGN_NAME}" (${source}); not AI-scored.`,
    };
    const company = await prisma.company.upsert({
      where: { domain: lead.domain },
      create: { ...fit, domain: lead.domain, website: `https://${lead.domain}`, industry: "Audit firm", acquisitionSource: source },
      update: fit,
    });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        email: lead.email,
        firstName: lead.firstName,
        timezone: timezoneForCountry(lead.country),
        // Left UNVERIFIED: the sender verifies the mailbox before step 1 (sender.ts).
        isBuyer: true,
        buyerPersona: "Audit firm",
      },
    });
    // File order is send order within a batch: the due-check cron takes the oldest nextSendAt first.
    const base = lead.batch === 1 ? now : batch2At.getTime();
    await prisma.outreach.create({
      data: {
        contactId: contact.id,
        companyId: company.id,
        campaignId: campaign.id,
        status: "PENDING",
        currentStep: 1,
        nextSendAt: new Date(base + enrolled * 1000),
      },
    });
    enrolled += 1;
  }
  console.log(`enrolled: ${enrolled}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
