/**
 * Re-send email 1, in the current template, to prospects who got an older
 * version and nothing after it. The old email stays on record with its
 * stepNumber cleared, so it no longer counts as step 1, isn't the thread
 * root, and doesn't block the new send. Their whole sequence is rewritten and
 * step 1 is due immediately (sent in their local window, within the daily cap).
 *
 *   pnpm tsx scripts/resend-first-email.ts --env $E --sent-before 2026-09-25T00:00:00Z [--dry-run]
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
  const before = new Date(arg("sent-before") ?? "");
  if (Number.isNaN(before.getTime())) throw new Error("--sent-before <ISO date> is required");
  const dryRun = process.argv.includes("--dry-run");

  const { prisma } = await import("@/lib/db");
  const { generateEmailSequence } = await import("@/lib/ai/email-generator");

  const outreaches = await prisma.outreach.findMany({
    where: {
      status: { in: ["ACTIVE", "PENDING"] },
      campaign: { status: "ACTIVE", clientId: null },
      emailMessages: {
        some: { direction: "OUTBOUND", stepNumber: 1, sentAt: { lt: before } },
        none: { OR: [{ direction: "INBOUND" }, { direction: "OUTBOUND", stepNumber: { gt: 1 } }] },
      },
    },
    include: { contact: true, company: true },
  });
  console.log(`prospects to re-send: ${outreaches.length}`);
  for (const o of outreaches) console.log(`  ${o.company?.name ?? "?"} <${o.contact.email}>`);
  if (dryRun) { await prisma.$disconnect(); return; }

  for (const o of outreaches) {
    const old = await prisma.emailMessage.findFirst({ where: { outreachId: o.id, direction: "OUTBOUND", stepNumber: 1 } });
    if (old) await prisma.emailMessage.update({ where: { id: old.id }, data: { stepNumber: null } });
    await prisma.outreachEmailDraft.deleteMany({ where: { outreachId: o.id } });
    await generateEmailSequence({ outreachId: o.id, contactId: o.contactId, campaignId: o.campaignId });
    await prisma.outreach.update({ where: { id: o.id }, data: { currentStep: 1, nextSendAt: new Date(), status: "ACTIVE" } });
    await prisma.auditLog.create({
      data: { actor: "system", action: "outreach.first_email_resend", entity: "Outreach", entityId: o.id, metadata: { supersededMessageId: old?.id ?? null } },
    });
  }
  console.log(`rewritten and due now: ${outreaches.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
