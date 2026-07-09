import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getBoss, enqueueFitScore, enqueueCompanyDiscover } from "@/lib/queue";

// ─── One-shot recovery for the 2026-07-09 AI outage ─────────────────────────
// The Anthropic account behind Growth ran out of credits, so fit.score failed
// 685× and left 113 companies unscored — which silently starved the outreach
// funnel (auto-enroll needs fitScore >= 6). This re-drives the stuck work.
//
//   RUN ONLY AFTER the AI provider is funded again (top up Anthropic and/or set
//   OPENAI_API_KEY). If you run it while the wallet is still empty, fit.score
//   just re-fails and the breaker in lib/ai/claude.ts will park the provider.
//
//   Safe to run more than once: fit.score is deduped per company by pg-boss
//   singletonKey, so re-runs never pile up duplicate jobs.
//
// Usage (on the box, from the deployed app dir so .env is loaded):
//   cd /home/ec2-user/growth/prod/apps/web
//   npx tsx src/scripts/recover-ai-pipeline.ts
//
// Flags (env vars):
//   DISCOVER=0  skip triggering a fresh company-discovery run
//   CONTENT=1   also kick the SEO content pipeline now instead of waiting for
//               its Tue/Thu cron (topic refresh first, publish 5 min later)

const prisma = new PrismaClient();

async function main() {
  const skipDiscover = process.env.DISCOVER === "0";
  const kickContent = process.env.CONTENT === "1";

  // 1. Re-drive fit scoring for every company the outage left unscored.
  const unscored = await prisma.company.findMany({
    where: { fitScore: null },
    select: { id: true },
  });
  let requeued = 0;
  for (const c of unscored) {
    const id = await enqueueFitScore({ companyId: c.id });
    if (id) requeued++;
  }
  console.log(`[recover] fit.score re-enqueued for ${requeued}/${unscored.length} unscored companies`);

  // 2. Trigger a fresh discovery run — same path as the weekly cron.
  if (!skipDiscover) {
    const run = await prisma.discoveryRun.create({ data: { source: "web_research" } });
    await enqueueCompanyDiscover({ runId: run.id });
    console.log(`[recover] discovery run ${run.id} triggered`);
  } else {
    console.log("[recover] discovery skipped (DISCOVER=0)");
  }

  // 3. Optionally kick the SEO content pipeline now (topics first, publish after).
  if (kickContent) {
    const boss = await getBoss();
    await boss.send("seo-topic-refresh", {});
    await boss.send("seo-auto-publish", {}, { startAfter: 300 });
    console.log("[recover] seo-topic-refresh sent; seo-auto-publish queued (+5m)");
  } else {
    console.log("[recover] content pipeline left to its cron (pass CONTENT=1 to kick now)");
  }

  // Our own pg-boss instance holds timers/connections open — stop it so the
  // process exits. This does not touch the long-running worker's instance.
  const boss = await getBoss();
  await boss.stop();
}

main()
  .catch((e) => {
    console.error("[recover] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
