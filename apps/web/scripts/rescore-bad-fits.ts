/**
 * Re-score companies whose fit score came from a broken AI answer.
 *
 *   pnpm tsx scripts/rescore-bad-fits.ts --env /home/ec2-user/growth/.env.production [--dry-run]
 *
 * Until 2026-09-24 the providers were never shown the answer schema, and a
 * malformed answer was recorded as REJECT ("[auto-REJECT: model returned
 * invalid fitProduct]"), writing off real companies. This clears those scores,
 * cancels any queued cross-use re-score for them, and queues a fresh score for
 * the product the company was imported for (Stripe billers → Revenue, others →
 * Trust), with the other product as the fallback. Also re-scores curated
 * Apollo leads rejected as a "weak fit" before applyCuratedListRule existed.
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
  const dryRun = process.argv.includes("--dry-run");

  const { prisma } = await import("@/lib/db");
  const bad = await prisma.company.findMany({
    where: {
      OR: [
        { fitReasoning: { startsWith: "[auto-REJECT: model returned invalid" } },
        // Curated Apollo leads rejected as a "weak fit" before the curated-list
        // rule existed; re-scoring runs them through it (hard rejects stay out).
        { acquisitionSource: { startsWith: "apollo:" }, fitProduct: "REJECT" },
      ],
    },
    select: { id: true, name: true, detectedTechs: true },
  });
  console.log(`companies with a broken-AI reject: ${bad.length}`);
  if (dryRun || bad.length === 0) {
    for (const c of bad.slice(0, 10)) console.log(`  ${c.name}`);
    await prisma.$disconnect();
    return;
  }

  const ids = bad.map((c) => c.id);
  const cancelled = await prisma.$executeRaw`
    DELETE FROM pgboss.job
    WHERE name = 'fit.score' AND state IN ('created', 'retry')
      AND data->>'companyId' = ANY(${ids})`;
  await prisma.company.updateMany({
    where: { id: { in: ids } },
    data: { fitProduct: null, fitScore: null, fitReasoning: null, fitScoredAt: null },
  });

  const { enqueueFitScore, getBoss } = await import("@/lib/queue");
  for (const [n, c] of bad.entries()) {
    const product = c.detectedTechs.some((t) => /\bstripe\b/i.test(t)) ? "REVENUE" : "TRUST";
    const other = product === "REVENUE" ? "TRUST" : "REVENUE";
    await enqueueFitScore(
      { companyId: c.id, products: [product], fallbackProducts: [other] },
      { startAfter: new Date(Date.now() + n * 60 * 1000) },
    );
  }
  console.log(`cancelled queued re-scores: ${cancelled}`);
  console.log(`re-queued: ${bad.length}`);
  await (await getBoss()).stop({ graceful: true }).catch(() => {});
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
