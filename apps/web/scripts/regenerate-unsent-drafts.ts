/**
 * Rewrite the drafts of every outreach that has not sent anything yet, so a
 * change to the writing rules applies to leads already enrolled.
 *
 *   pnpm tsx scripts/regenerate-unsent-drafts.ts --env /home/ec2-user/growth/.env.production [--dry-run]
 */
import { readFileSync } from "fs";

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const i = process.argv.indexOf("--env");
  if (i >= 0) loadEnvFile(process.argv[i + 1]!);
  const { prisma } = await import("@/lib/db");

  const unsent = await prisma.outreach.findMany({
    where: {
      status: { in: ["PENDING", "ACTIVE"] },
      emailMessages: { none: { direction: "OUTBOUND" } },
      emailDrafts: { some: {} },
    },
    select: { id: true },
  });
  console.log(`unsent outreaches with drafts: ${unsent.length}`);
  if (process.argv.includes("--dry-run") || unsent.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const ids = unsent.map((o) => o.id);
  const deleted = await prisma.outreachEmailDraft.deleteMany({ where: { outreachId: { in: ids } } });
  const { enqueueEmailGenerate, getBoss } = await import("@/lib/queue");
  for (const id of ids) await enqueueEmailGenerate({ outreachId: id });
  console.log(`deleted ${deleted.count} drafts, queued ${ids.length} rewrites`);
  await (await getBoss()).stop({ graceful: true }).catch(() => {});
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
