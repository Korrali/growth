-- AUDITOR campaigns offer audit firms (CPA firms that issue SOC 2 reports) a
-- listing as a Korrali Trust audit partner. Fixed template, never auto-enrolled into.
ALTER TYPE "CampaignAudience" ADD VALUE IF NOT EXISTS 'AUDITOR';
