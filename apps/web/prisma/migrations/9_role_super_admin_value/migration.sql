-- Prod Role enum was missing SUPER_ADMIN (drift) — onboarding 500'd on
-- organization.create. Idempotent for environments that already have it.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'ADMIN';
