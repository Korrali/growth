/**
 * Trust relaunch: restart the sequence, in the current template, for every
 * prospect who got a Trust email before TRUST_RELAUNCH_AT — whatever state
 * their outreach is in (mid-sequence, completed, or stopped by the old AI
 * quality gate). Their email 1 re-introduces Trust (email-generator.ts sees
 * the earlier email), in a new thread.
 *
 * Skipped: suppressed or unsubscribed contacts, invalid/disposable addresses,
 * addresses or domains on the suppression list, anyone who ever replied, and
 * a contact who already has an outreach in the target campaign.
 *
 * Per prospect: every earlier outbound email keeps its record but loses its
 * stepNumber (not a thread root, not counted against maxFollowUps), all
 * drafts are deleted and rewritten, the outreach moves to the target
 * campaign and step 1 is due now. It still sends only while that campaign is
 * ACTIVE, in the recipient's window, within the daily cap.
 *
 *   pnpm tsx scripts/resend-trust-relaunch.ts --env $E --campaign <id> [--dry-run]
 */
import { readFileSync } from "fs";

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const envFile = arg("env");
  if (envFile) loadEnvFile(envFile);
  const campaignId = arg("campaign");
  if (!campaignId) throw new Error("--campaign <target Trust campaign id> is required");
  const dryRun = process.argv.includes("--dry-run");

  const { prisma } = await import("@/lib/db");
  const { generateEmailSequence } = await import("@/lib/ai/email-generator");
  const { TRUST_RELAUNCH_AT } = await import("@/lib/sending/templates");
  const { isEmailSuppressed, isDomainSuppressed } = await import("@/lib/sending/suppression");

  const target = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (target.product !== "TRUST" || target.clientId) throw new Error(`${target.name} is not an internal Trust campaign`);

  const outreaches = await prisma.outreach.findMany({
    where: {
      campaign: { product: "TRUST", clientId: null },
      emailMessages: { some: { direction: "OUTBOUND", sentAt: { lt: TRUST_RELAUNCH_AT } } },
    },
    include: { contact: true, company: true, campaign: true },
    orderBy: { createdAt: "asc" },
  });

  const go: typeof outreaches = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const o of outreaches) {
    const c = o.contact;
    const label = `${o.company?.name ?? "?"} <${c.email}>`;
    const domain = c.email.split("@")[1] ?? "";
    let why: string | null = null;
    if (seen.has(c.id)) why = "duplicate outreach for this contact";
    else if (c.suppressedAt) why = `suppressed (${c.suppressReason ?? "?"})`;
    else if (c.emailStatus === "INVALID" || c.emailStatus === "DISPOSABLE") why = `email ${c.emailStatus}`;
    else if (await isEmailSuppressed(c.email)) why = "email on suppression list";
    else if (domain && (await isDomainSuppressed(domain))) why = "domain on suppression list";
    else if (await prisma.emailMessage.count({ where: { contactId: c.id, direction: "INBOUND" } })) why = "has replied";
    else if (
      o.campaignId !== target.id &&
      (await prisma.outreach.count({ where: { contactId: c.id, campaignId: target.id } }))
    ) why = "already has an outreach in the target campaign";
    seen.add(c.id);
    if (why) skipped.push(`  SKIP ${label}: ${why}`);
    else go.push(o);
  }

  console.log(`already emailed: ${outreaches.length}, re-send: ${go.length}, skipped: ${skipped.length}`);
  for (const s of skipped) console.log(s);
  for (const o of go) {
    const notes = [
      o.campaign.name !== target.name ? `from "${o.campaign.name}"` : null,
      `${o.status}`,
      !o.contact.isBuyer ? "NOT isBuyer — send gate will stop it" : null,
      (o.company?.fitScore ?? 0) < 6 ? `fitScore ${o.company?.fitScore ?? 0} — send gate will stop it` : null,
    ].filter(Boolean);
    console.log(`  ${o.company?.name ?? "?"} <${o.contact.email}> (${notes.join(", ")})`);
  }
  if (dryRun) { await prisma.$disconnect(); return; }

  for (const o of go) {
    const superseded = await prisma.emailMessage.updateMany({
      where: { outreachId: o.id, direction: "OUTBOUND", stepNumber: { not: null } },
      data: { stepNumber: null },
    });
    await prisma.outreachEmailDraft.deleteMany({ where: { outreachId: o.id } });
    await prisma.outreach.update({
      where: { id: o.id },
      data: { campaignId: target.id, status: "ACTIVE", currentStep: 1, nextSendAt: new Date(), stoppedAt: null, stoppedReason: null },
    });
    await generateEmailSequence({ outreachId: o.id, contactId: o.contactId, campaignId: target.id });
    const step1 = await prisma.outreachEmailDraft.findUnique({ where: { outreachId_stepNumber: { outreachId: o.id, stepNumber: 1 } } });
    if (!step1?.body.includes("I wrote to you a while back about Korrali Trust")) {
      throw new Error(`${o.contact.email}: email 1 is not the re-introduction — stopping`);
    }
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.trust_relaunch_resend",
        entity: "Outreach",
        entityId: o.id,
        metadata: { fromCampaignId: o.campaignId, previousStatus: o.status, supersededMessages: superseded.count },
      },
    });
  }
  console.log(`rewritten and due now: ${go.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
