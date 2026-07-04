-- Landing page analysis: stored per company after fit scoring, used to personalize Step 1 emails
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "landingPageAnalysis" JSONB;

-- Critics review results: stored per draft after adversarial quality check
ALTER TABLE "OutreachEmailDraft" ADD COLUMN IF NOT EXISTS "criticsPassed" BOOLEAN;
ALTER TABLE "OutreachEmailDraft" ADD COLUMN IF NOT EXISTS "criticsFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
