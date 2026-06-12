import "dotenv/config";
import { getBoss, QUEUE_NAMES } from "@/lib/queue";
import { sendOutreachStep } from "@/lib/sending/sender";
import { scoreFitForCompany } from "@/lib/ai/fit-scorer";
import { generateEmailSequence } from "@/lib/ai/email-generator";
import { classifyReply } from "@/lib/ai/reply-classifier";
import { generateCallBrief, generateCallFollowup } from "@/lib/ai/call-briefer";
import { runTrialIntervention, runTrialWinback } from "@/lib/trials/intervention-engine";
import { WINBACK_SCHEDULE_DAYS } from "@/lib/trials/sequences";
import { generateWeeklyInsights } from "@/lib/ai/weekly-insights";
import { generateContent } from "@/lib/ai/content-generator";
import { distributeContent } from "@/lib/content/distributor";
import { sendAutoReply } from "@/lib/sending/reply-sender";
import { discoverCompanies } from "@/lib/ai/company-discoverer";
import { findContactForCompany } from "@/lib/import/contact-finder";
import { runCommunityScan } from "@/lib/community/scanner";
import { buildLinkedInDraft } from "@/lib/linkedin/draft-builder";
import { processVisitor } from "@/lib/visitor/processor";
import { ContentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueOutreachSend,
  enqueueTrialIntervention,
  enqueueWeeklyInsights,
  enqueueCompanyDiscover,
  enqueueCommunityScan,
  type VisitorProcessPayload,
} from "@/lib/queue";

async function main() {
  const boss = await getBoss();
  console.log("[worker] pg-boss started");

  boss.on("error", (err: Error) => {
    console.error("[worker] boss error:", err);
  });

  // Create all queues before registering workers — pg-boss requires the queue
  // row to exist before boss.work() can attach a handler to it.
  const allQueues = [
    "outreach-due-check", "weekly-insights-trigger",
    "trial-daily-check", "company-discover-trigger",
    "linkedin-draft-trigger", "content-distribute-check",
    QUEUE_NAMES.OUTREACH_SEND, QUEUE_NAMES.FIT_SCORE,
    QUEUE_NAMES.EMAIL_GENERATE, QUEUE_NAMES.REPLY_CLASSIFY,
    QUEUE_NAMES.REPLY_AUTO_SEND, QUEUE_NAMES.TRIAL_INTERVENTION,
    QUEUE_NAMES.WEEKLY_INSIGHTS, QUEUE_NAMES.CONTENT_GENERATE,
    QUEUE_NAMES.CONTENT_DISTRIBUTE,
    QUEUE_NAMES.CALL_BRIEF, QUEUE_NAMES.CALL_FOLLOWUP,
    QUEUE_NAMES.COMPANY_DISCOVER, QUEUE_NAMES.CONTACT_FIND,
    "community-scan-trigger", "seo-topic-refresh", QUEUE_NAMES.COMMUNITY_SCAN,
    QUEUE_NAMES.LINKEDIN_DRAFT, QUEUE_NAMES.VISITOR_PROCESS,
  ];
  for (const q of allQueues) {
    await boss.createQueue(q);
  }
  console.log("[worker] all queues registered");

  // Outreach send handler
  await boss.work<{ outreachId: string; stepNumber: number }>(
    QUEUE_NAMES.OUTREACH_SEND,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      const { outreachId, stepNumber } = job.data;
      console.log(`[worker] outreach.send ${outreachId} step ${stepNumber}`);
      await sendOutreachStep(outreachId, stepNumber);
    },
  );

  // Fit score handler
  await boss.work<{ companyId: string }>(
    QUEUE_NAMES.FIT_SCORE,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] fit.score ${job.data.companyId}`);
      await scoreFitForCompany(job.data.companyId);
    },
  );

  // Email generation handler
  await boss.work<{ outreachId: string }>(
    QUEUE_NAMES.EMAIL_GENERATE,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      const outreach = await prisma.outreach.findUnique({
        where: { id: job.data.outreachId },
        select: { contactId: true, campaignId: true },
      });
      if (!outreach) return;
      console.log(`[worker] email.generate ${job.data.outreachId}`);
      await generateEmailSequence({
        outreachId: job.data.outreachId,
        contactId: outreach.contactId,
        campaignId: outreach.campaignId,
      });
    },
  );

  // Reply classify handler
  await boss.work<{ messageId: string }>(
    QUEUE_NAMES.REPLY_CLASSIFY,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] reply.classify ${job.data.messageId}`);
      await classifyReply(job.data.messageId);
    },
  );

  // INTERESTED reply auto-send handler (fires after 2-hour window)
  await boss.work<{ classificationId: string }>(
    QUEUE_NAMES.REPLY_AUTO_SEND,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] reply.auto-send ${job.data.classificationId}`);
      await sendAutoReply(job.data.classificationId);
    },
  );

  // Contact finder handler (fires after fit score >= 7)
  await boss.work<{ companyId: string }>(
    QUEUE_NAMES.CONTACT_FIND,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] contact.find ${job.data.companyId}`);
      await findContactForCompany(job.data.companyId);
    },
  );

  // Community scan handler (Reddit + HN + IH)
  await boss.work(
    QUEUE_NAMES.COMMUNITY_SCAN,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log("[worker] community.scan");
      await runCommunityScan();
    },
  );

  // LinkedIn draft generation handler
  await boss.work<{ contactId: string }>(
    QUEUE_NAMES.LINKEDIN_DRAFT,
    { batchSize: 1, localConcurrency: 2 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] linkedin.draft ${job.data.contactId}`);
      await buildLinkedInDraft(job.data.contactId);
    },
  );

  // Visitor intent processing handler
  await boss.work<VisitorProcessPayload>(
    QUEUE_NAMES.VISITOR_PROCESS,
    { batchSize: 1, localConcurrency: 3 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] visitor.process ${job.data.ip}`);
      await processVisitor(job.data);
    },
  );

  // Content distribute handler (fires when scheduledFor is reached)
  await boss.work<{ draftId: string }>(
    QUEUE_NAMES.CONTENT_DISTRIBUTE,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] content.distribute ${job.data.draftId}`);
      await distributeContent(job.data.draftId);
    },
  );

  // Company discovery handler
  await boss.work<{ runId: string }>(
    QUEUE_NAMES.COMPANY_DISCOVER,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] company.discover run=${job.data.runId}`);
      await discoverCompanies(job.data.runId);
    },
  );

  // Trial intervention handler (activation nudges + post-expiry win-backs)
  await boss.work<{ trialId: string; dayBucket: string; winback?: boolean }>(
    QUEUE_NAMES.TRIAL_INTERVENTION,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      if (job.data.winback) {
        console.log(`[worker] trial.winback ${job.data.trialId}`);
        await runTrialWinback(job.data.trialId);
      } else {
        console.log(`[worker] trial.intervention ${job.data.trialId}`);
        await runTrialIntervention(job.data.trialId);
      }
    },
  );

  // Call brief handler
  await boss.work<{ callId: string }>(
    QUEUE_NAMES.CALL_BRIEF,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] call.brief ${job.data.callId}`);
      await generateCallBrief(job.data.callId);
    },
  );

  // Call follow-up handler
  await boss.work<{ callId: string }>(
    QUEUE_NAMES.CALL_FOLLOWUP,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] call.followup ${job.data.callId}`);
      await generateCallFollowup(job.data.callId);
    },
  );

  // Weekly insights handler
  await boss.work<{ weekOf: string }>(
    QUEUE_NAMES.WEEKLY_INSIGHTS,
    { batchSize: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] weekly.insights ${job.data.weekOf}`);
      await generateWeeklyInsights(new Date(job.data.weekOf));
    },
  );

  // Content generation handler
  await boss.work<{ type: string; sourceData: Record<string, unknown> }>(
    QUEUE_NAMES.CONTENT_GENERATE,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] content.generate ${job.data.type}`);
      await generateContent(job.data.type as ContentType, job.data.sourceData);
    },
  );

  // ─── Cron job handlers ───────────────────────────────────────────────────────

  // Every 15 min: find outreaches due for sending and enqueue them
  await boss.work("outreach-due-check", async ([job]) => {
    if (!job) return;
    const due = await prisma.outreach.findMany({
      where: {
        status: { in: ["ACTIVE", "PENDING"] },
        nextSendAt: { lte: new Date() },
      },
      select: { id: true, currentStep: true },
      take: 100,
    });

    for (const o of due) {
      await enqueueOutreachSend({ outreachId: o.id, stepNumber: o.currentStep });
    }

    if (due.length > 0) {
      console.log(`[cron] outreach-due-check: enqueued ${due.length} outreaches`);
    }
  });

  // Monday 6am UTC: generate weekly insights
  await boss.work("weekly-insights-trigger", async ([job]) => {
    if (!job) return;
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    const day = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    await enqueueWeeklyInsights({ weekOf: monday.toISOString() });
    console.log("[cron] weekly-insights-trigger: enqueued");
  });

  // Daily 7am UTC: expire overdue trials, nudge at-risk ones, win-back expired ones
  await boss.work("trial-daily-check", async ([job]) => {
    if (!job) return;
    const now = new Date();

    // 1. ACTIVE trials past their end date become EXPIRED (win-back eligible)
    const expired = await prisma.trial.updateMany({
      where: { status: "ACTIVE", trialEndsAt: { lt: now } },
      data: { status: "EXPIRED", expiredAt: now },
    });

    // 2. Activation interventions for at-risk active trials
    const atRisk = await prisma.trial.findMany({
      where: {
        status: "ACTIVE",
        activationRisk: { in: ["HIGH", "CRITICAL"] },
      },
      select: { id: true },
    });

    const today = now.toISOString().slice(0, 10);
    for (const t of atRisk) {
      await enqueueTrialIntervention({ trialId: t.id, dayBucket: today });
    }

    // 3. Win-backs: step N due WINBACK_SCHEDULE_DAYS[N] days after expiry
    const expiredTrials = await prisma.trial.findMany({
      where: {
        status: "EXPIRED",
        winbacksSent: { lt: WINBACK_SCHEDULE_DAYS.length },
        expiredAt: { not: null },
      },
      select: { id: true, winbacksSent: true, expiredAt: true },
    });

    let winbacksEnqueued = 0;
    for (const t of expiredTrials) {
      const dueDays = WINBACK_SCHEDULE_DAYS[t.winbacksSent];
      const dueAt = new Date(t.expiredAt!.getTime() + dueDays * 24 * 60 * 60 * 1000);
      if (dueAt <= now) {
        await enqueueTrialIntervention({ trialId: t.id, dayBucket: today, winback: true });
        winbacksEnqueued++;
      }
    }

    if (expired.count + atRisk.length + winbacksEnqueued > 0) {
      console.log(
        `[cron] trial-daily-check: expired ${expired.count}, interventions ${atRisk.length}, winbacks ${winbacksEnqueued}`,
      );
    }
  });

  // Daily 8am UTC: scan Reddit (1×/day preserves Tavily budget) + HN + IH
  // After scan completes, re-analyze topics so the SEO page stays fresh
  await boss.work("community-scan-trigger", async ([job]) => {
    if (!job) return;
    await enqueueCommunityScan();
    console.log("[cron] community-scan-trigger: enqueued");
  });

  // Weekly Monday 10am UTC: re-analyze community mentions → refresh SEO topic suggestions
  // Topics are stored as a JSON blob in a well-known ContentDraft (slug: "__seo_topics__")
  // so the /growth/seo page can show pre-computed suggestions without waiting for Claude.
  await boss.work("seo-topic-refresh", async ([job]) => {
    if (!job) return;
    const { analyzeSeoTopics } = await import("@/lib/ai/seo-topic-analyzer");
    const topics = await analyzeSeoTopics();
    if (topics.length === 0) return;
    await prisma.contentDraft.upsert({
      where: { slug: "__seo_topics__" },
      create: {
        type: ContentType.BLOG_POST,
        slug: "__seo_topics__",
        title: "SEO Topic Cache",
        body: JSON.stringify(topics),
        status: "draft",
        product: "TRUST",
      },
      update: { body: JSON.stringify(topics) },
    });
    console.log(`[cron] seo-topic-refresh: cached ${topics.length} topics`);
  });

  // Daily 9am UTC: generate LinkedIn drafts for new qualified contacts
  await boss.work("linkedin-draft-trigger", async ([job]) => {
    if (!job) return;
    const contacts = await prisma.contact.findMany({
      where: {
        linkedinUrl: { not: null },
        isBuyer: true,
        linkedInOutreach: null,
        company: { fitProduct: { not: "REJECT" }, fitScore: { gte: 6 } },
      },
      select: { id: true },
      take: 50,
    });
    for (const c of contacts) {
      const { enqueueLinkedInDraft } = await import("@/lib/queue");
      await enqueueLinkedInDraft({ contactId: c.id });
    }
    if (contacts.length > 0) {
      console.log(`[cron] linkedin-draft-trigger: enqueued ${contacts.length} drafts`);
    }
  });

  // Every 30 min: check for content drafts due to distribute
  await boss.work("content-distribute-check", async ([job]) => {
    if (!job) return;
    const due = await prisma.contentDraft.findMany({
      where: { status: "scheduled", scheduledFor: { lte: new Date() } },
      select: { id: true },
      take: 20,
    });
    for (const d of due) {
      const { enqueueContentDistribute } = await import("@/lib/queue");
      await enqueueContentDistribute({ draftId: d.id });
    }
    if (due.length > 0) {
      console.log(`[cron] content-distribute-check: enqueued ${due.length} drafts`);
    }
  });

  // Wednesday 5am UTC: discover new companies via web research
  await boss.work("company-discover-trigger", async ([job]) => {
    if (!job) return;
    const run = await prisma.discoveryRun.create({
      data: { source: "web_research" },
    });
    await enqueueCompanyDiscover({ runId: run.id });
    console.log(`[cron] company-discover-trigger: created run ${run.id}`);
  });


  await boss.schedule("outreach-due-check",       "*/15 * * * *");
  await boss.schedule("weekly-insights-trigger",  "0 6 * * 1");
  await boss.schedule("trial-daily-check",        "0 7 * * *");
  await boss.schedule("company-discover-trigger", "0 5 * * 1-5");   // Mon-Fri 5am UTC
  await boss.schedule("community-scan-trigger",   "0 8 * * *");     // daily 8am UTC (Tavily budget)
  await boss.schedule("seo-topic-refresh",        "0 10 * * 1");    // weekly Mon 10am UTC
  await boss.schedule("linkedin-draft-trigger",   "0 9 * * *");     // daily 9am UTC
  await boss.schedule("content-distribute-check", "*/30 * * * *");  // every 30 min

  console.log("[worker] all handlers registered, crons scheduled");
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
