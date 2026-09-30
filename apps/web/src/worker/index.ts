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
import { runAutoEnroll } from "@/lib/enroll/auto-enroll";
import { pollInbox } from "@/lib/mail/inbox-poller";
import { sendDailyDigest } from "@/lib/digest/daily-digest";
import { syncTracker } from "@/lib/tracker/sheet-sync";
import { SEO_TOPIC_CACHE_SLUG } from "@/lib/content-slugs";
import { ContentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MarketedProduct } from "@/lib/products";
import {
  enqueueFitScore,
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
    "seo-auto-publish", "auto-enroll-check",
    "inbox-poll", "daily-digest", "tracker-sync",
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
  await boss.work<{ companyId: string; products?: string[]; fallbackProducts?: string[] }>(
    QUEUE_NAMES.FIT_SCORE,
    { batchSize: 1, localConcurrency: 1 },
    async ([job]) => {
      if (!job) return;
      console.log(`[worker] fit.score ${job.data.companyId}`);
      const result = await scoreFitForCompany(job.data.companyId, {
        products: job.data.products as MarketedProduct[] | undefined,
      });
      // Cross-use: not a fit for the product it was imported for → give the
      // other product a look before the lead is written off. Suppressed
      // domains are never re-scored.
      const fallback = job.data.fallbackProducts;
      if (
        fallback?.length &&
        (result.fitProduct === "REJECT" || result.fitScore < 6) &&
        !result.fitReasoning.startsWith("[auto-REJECT: domain suppressed")
      ) {
        await enqueueFitScore(
          { companyId: job.data.companyId, products: fallback },
          { startAfter: new Date(Date.now() + 60 * 60 * 1000) },
        );
      }
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

  // Every 2 hours: auto-enroll fit ≥6 companies into the matching active
  // internal campaign (finds contacts first where missing). Send volume is
  // still governed by the send budget (send-budget.ts).
  await boss.work("auto-enroll-check", async ([job]) => {
    if (!job) return;
    const summary = await runAutoEnroll();
    if (summary.enrolled > 0 || summary.contactFindsQueued > 0) {
      console.log(
        `[cron] auto-enroll-check: enrolled=${summary.enrolled} contactFinds=${summary.contactFindsQueued} noCampaign=${summary.skippedNoCampaign}`,
      );
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

  // Mon/Wed/Fri 8am UTC: scan Reddit + IH (Tavily) + HN (free). 3×/week keeps
  // the shared Tavily quota free for on-demand company discovery / contact import.
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
      where: { slug: SEO_TOPIC_CACHE_SLUG },
      create: {
        type: ContentType.BLOG_POST,
        slug: SEO_TOPIC_CACHE_SLUG,
        title: "SEO Topic Cache",
        body: JSON.stringify(topics),
        status: "draft",
        product: "TRUST",
      },
      // Force status back to "draft" — a bulk publish once flipped this row to
      // "posted" and it went live as a public blog post.
      update: { body: JSON.stringify(topics), status: "draft" },
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

  // Tue + Thu 11am UTC: generate and publish up to 3 SEO articles from the
  // cached topic queue — full autopilot, no founder click required. Articles
  // go straight to "posted" and are served by /api/blog on each product site.
  await boss.work("seo-auto-publish", async ([job]) => {
    if (!job) return;
    const { analyzeSeoTopics } = await import("@/lib/ai/seo-topic-analyzer");
    const { generateSeoArticle, saveArticleDraft } = await import("@/lib/ai/seo-article-generator");

    type CachedTopic = Awaited<ReturnType<typeof analyzeSeoTopics>>[number];
    let topics: CachedTopic[] = [];
    const cache = await prisma.contentDraft.findUnique({ where: { slug: SEO_TOPIC_CACHE_SLUG } });
    if (cache?.body) {
      try { topics = JSON.parse(cache.body) as CachedTopic[]; } catch { /* fall through */ }
    }

    // A cache written before a product was onboarded would otherwise starve
    // that product until the next weekly refresh — which is how Data and Web
    // could still publish nothing on the first run after being wired up.
    // Treat "no topics at all for a product that should always yield some" as
    // stale, not as a legitimate empty result.
    const { PRODUCTS, MARKETED_PRODUCT_KEYS } = await import("@/lib/products");
    const alwaysExpected = MARKETED_PRODUCT_KEYS.filter((k) => PRODUCTS[k].topicSourcing === "catalog");
    const missing = alwaysExpected.filter((k) => !topics.some((t) => t.product === k));
    if (topics.length === 0 || missing.length > 0) {
      if (missing.length > 0) {
        console.log(`[cron] seo-auto-publish: topic cache missing ${missing.join(",")} — refreshing`);
      }
      topics = await analyzeSeoTopics();
      await prisma.contentDraft.update({
        where: { slug: SEO_TOPIC_CACHE_SLUG },
        data: { body: JSON.stringify(topics), status: "draft" },
      }).catch(() => { /* cache row may not exist yet; refresh cron will create it */ });
    }

    const existing = await prisma.contentDraft.findMany({
      where: { type: ContentType.BLOG_POST },
      select: { targetKeyword: true, product: true, status: true },
    });
    const covered = new Set(existing.map((e) => e.targetKeyword).filter(Boolean));

    // How many articles each product has actually shipped — drives who picks first.
    const published = new Map<string, number>();
    for (const e of existing) {
      if (e.status !== "posted" || !e.product) continue;
      published.set(e.product, (published.get(e.product) ?? 0) + 1);
    }

    // Round-robin across products instead of taking the global top 3. A flat
    // slice let Trust/Revenue topics occupy every slot indefinitely, which is
    // how Data and Web stayed at zero articles after being onboarded — the
    // backlog never emptied, so their topics were never reached.
    const buckets = new Map<string, CachedTopic[]>();
    for (const t of topics) {
      if (covered.has(t.targetKeyword)) continue;
      const bucket = buckets.get(t.product) ?? [];
      bucket.push(t);
      buckets.set(t.product, bucket);
    }
    const order = [...buckets.keys()].sort(
      (a, b) => (published.get(a) ?? 0) - (published.get(b) ?? 0) || a.localeCompare(b),
    );

    const todo: CachedTopic[] = [];
    while (todo.length < 3) {
      const before = todo.length;
      for (const product of order) {
        if (todo.length >= 3) break;
        const next = buckets.get(product)?.shift();
        if (next) todo.push(next);
      }
      if (todo.length === before) break; // every bucket drained
    }

    for (const topic of todo) {
      try {
        const body = await generateSeoArticle(topic);
        const draftId = await saveArticleDraft(topic, body);
        await prisma.contentDraft.update({
          where: { id: draftId },
          data: { status: "posted", postedAt: new Date() },
        });
        console.log(`[cron] seo-auto-publish: published "${topic.suggestedTitle}" (${topic.product})`);
      } catch (err) {
        console.error(`[cron] seo-auto-publish: failed "${topic.suggestedTitle}":`, err);
      }
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


  // Read replies out of the Workspace mailbox. No-op without GMAIL_* creds.
  await boss.work("inbox-poll", async ([job]) => {
    if (!job) return;
    const summary = await pollInbox();
    if (summary.captured || summary.bounces) {
      console.log(
        `[cron] inbox-poll: scanned=${summary.scanned} captured=${summary.captured} bounces=${summary.bounces}`,
      );
    }
  });

  // The founder's distribution tracker (Google Sheet): sends and replies.
  // No-op without TRACKER_WEBHOOK_*.
  await boss.work("tracker-sync", async ([job]) => {
    if (!job) return;
    const result = await syncTracker();
    if (!result.skipped) console.log(`[cron] tracker-sync: rows=${result.rows} updated=${result.updated} appended=${result.appended}`);
  });

  // Founder's morning sheet.
  await boss.work("daily-digest", async ([job]) => {
    if (!job) return;
    await sendDailyDigest();
    console.log("[cron] daily-digest: sent");
  });

  await boss.schedule("outreach-due-check",       "*/15 * * * *");
  await boss.schedule("inbox-poll",               "*/5 * * * *");
  await boss.schedule("tracker-sync",             "*/15 * * * *");  // after sends (15-min cadence) and replies (5-min poll)
  await boss.schedule("daily-digest",             "30 2 * * *");    // 02:30 UTC = 08:00 IST, after the US send day closes
  await boss.schedule("weekly-insights-trigger",  "0 6 * * 1");
  await boss.schedule("trial-daily-check",        "0 7 * * *");
  await boss.schedule("company-discover-trigger", "0 5 * * 1");     // Mon 5am UTC — weekly; free Tavily plan (~35 credits/run, keep <200/mo incl. community scans)
  await boss.schedule("community-scan-trigger",   "0 8 * * 1");     // Mon 8am UTC — weekly (cut from Mon/Wed/Fri 2026-07-09 to trim Tavily spend)
  await boss.schedule("seo-topic-refresh",        "0 10 * * 1");    // weekly Mon 10am UTC
  await boss.schedule("linkedin-draft-trigger",   "0 9 * * *");     // daily 9am UTC
  await boss.schedule("content-distribute-check", "*/30 * * * *");  // every 30 min
  await boss.schedule("seo-auto-publish",         "0 11 * * 2,4");  // Tue + Thu 11am UTC — 6 articles/week
  await boss.schedule("auto-enroll-check",        "15 */2 * * *");  // every 2h — fit≥6 → contact → campaign

  console.log("[worker] all handlers registered, crons scheduled");
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
