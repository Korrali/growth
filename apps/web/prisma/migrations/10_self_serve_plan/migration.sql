-- Add SELF_SERVE to ClientPlan enum for $300/mo self-signup tier
ALTER TYPE "ClientPlan" ADD VALUE IF NOT EXISTS 'SELF_SERVE';
