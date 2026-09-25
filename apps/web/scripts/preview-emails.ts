/**
 * Write real drafts for the next N prospects (both active campaigns) and print
 * them exactly as they will be sent, for review before --start. The drafts
 * are kept and used for the actual sends.
 *
 *   pnpm tsx scripts/preview-emails.ts --env /home/ec2-user/growth/.env.production [--count 10]
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
  const count = parseInt(arg("count") ?? "10", 10);
  const { prisma } = await import("@/lib/db");
  const { generateEmailSequence } = await import("@/lib/ai/email-generator");
  const { withSignOff } = await import("@/lib/sending/sender-identity");

  const campaigns = await prisma.campaign.findMany({ where: { status: "ACTIVE", clientId: null }, select: { id: true, product: true } });
  const out: string[] = [];
  let total = 0;
  for (const c of campaigns) {
    const take = Math.ceil(count / campaigns.length);
    const outreaches = await prisma.outreach.findMany({
      where: { campaignId: c.id, status: { in: ["PENDING", "ACTIVE"] }, emailMessages: { none: { direction: "OUTBOUND" } } },
      include: { contact: true, company: true },
      orderBy: { createdAt: "asc" },
      take,
    });
    for (const o of outreaches) {
      const steps = await generateEmailSequence({ outreachId: o.id, contactId: o.contactId, campaignId: c.id });
      const run = await prisma.emailGenerationRun.findFirst({ where: { outreachId: o.id }, orderBy: { createdAt: "desc" }, select: { model: true } });
      total += 1;
      out.push(`\n==================== ${c.product} · ${o.company?.name} · ${o.contact.firstName ?? ""} ${o.contact.lastName ?? ""} <${o.contact.email}> · tz ${o.contact.timezone ?? "campaign"} · writer ${run?.model}`);
      for (const s of steps) {
        const subject = s.stepNumber === 1 ? s.subject : `Re: ${steps[0]!.subject}`;
        out.push(`\n--- Step ${s.stepNumber}  |  Subject: ${subject}\n\n${withSignOff(s.body)}\n\n—\nNot relevant? Reply "no thanks" and I won't email again.`);
      }
    }
  }
  console.log(out.join("\n"));
  console.log(`\n${total} prospects previewed`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
