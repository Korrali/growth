-- Add GROWTH_SERVICE to CampaignProduct enum
ALTER TYPE "CampaignProduct" ADD VALUE IF NOT EXISTS 'GROWTH_SERVICE';

-- Add ClientPlan and ClientStatus enums
DO $$ BEGIN
  CREATE TYPE "ClientPlan" AS ENUM ('RETAINER', 'PAY_PER_MEETING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CHURNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create Client table
CREATE TABLE IF NOT EXISTS "Client" (
  "id"                   TEXT NOT NULL,
  "name"                 TEXT NOT NULL,
  "contactEmail"         TEXT NOT NULL,
  "plan"                 "ClientPlan" NOT NULL,
  "status"               "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "icpProfile"           TEXT NOT NULL,
  "fromName"             TEXT NOT NULL,
  "fromEmail"            TEXT NOT NULL,
  "inboundDomain"        TEXT,
  "stripeCustomerId"     TEXT,
  "stripeSubscriptionId" TEXT,
  "setupFeeUsd"          INTEGER NOT NULL DEFAULT 0,
  "monthlyFeeUsd"        INTEGER NOT NULL DEFAULT 0,
  "perMeetingFeeUsd"     INTEGER NOT NULL DEFAULT 0,
  "notes"                TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Client_contactEmail_key" ON "Client"("contactEmail");

-- Add client-related columns to Campaign
ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "clientId"         TEXT,
  ADD COLUMN IF NOT EXISTS "replyForwardTo"   TEXT,
  ADD COLUMN IF NOT EXISTS "fromName"         TEXT,
  ADD COLUMN IF NOT EXISTS "fromEmail"        TEXT,
  ADD COLUMN IF NOT EXISTS "customIcpProfile" TEXT;

-- Foreign key: Campaign.clientId → Client.id
DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "Campaign_clientId_idx" ON "Campaign"("clientId");
