-- Schema drift repair (2026-06-12): prod was missing the DiscoveryRun table
-- (every company-discovery cron run crashed) and the ReplyClassification
-- auto-send columns (INTERESTED-reply auto-send would crash). Idempotent so
-- environments that already have these (via db push) are unaffected.
CREATE TABLE IF NOT EXISTS "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web_research',
    "queriesRun" INTEGER NOT NULL DEFAULT 0,
    "companiesFound" INTEGER NOT NULL DEFAULT 0,
    "companiesNew" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReplyClassification" ADD COLUMN IF NOT EXISTS "autoSendAt" TIMESTAMP(3);
ALTER TABLE "ReplyClassification" ADD COLUMN IF NOT EXISTS "autoSendCancelledAt" TIMESTAMP(3);
ALTER TABLE "ReplyClassification" ADD COLUMN IF NOT EXISTS "autoSentAt" TIMESTAMP(3);
