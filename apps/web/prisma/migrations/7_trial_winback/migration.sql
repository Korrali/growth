-- Post-expiry win-back emails: track how many were sent and when the trial expired.
ALTER TABLE "Trial" ADD COLUMN "winbacksSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trial" ADD COLUMN "expiredAt" TIMESTAMP(3);
