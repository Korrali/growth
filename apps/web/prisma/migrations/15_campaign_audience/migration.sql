-- FIRM campaigns write to service firms (fractional CFOs, vCISOs) with their
-- own template and are never auto-enrolled into. Existing campaigns are DIRECT.
DO $$ BEGIN
  CREATE TYPE "CampaignAudience" AS ENUM ('DIRECT', 'FIRM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "audience" "CampaignAudience" NOT NULL DEFAULT 'DIRECT';
