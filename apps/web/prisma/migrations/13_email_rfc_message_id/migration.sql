-- Cold outbound moves from Resend to the Google Workspace mailbox (SMTP send,
-- IMAP read). A reply is matched to its outreach through the RFC 5322
-- Message-ID of the email it answers (In-Reply-To / References), so every
-- message now stores its own. Additive and nullable: Resend-era rows are
-- untouched.
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "rfcMessageId" TEXT;
CREATE INDEX IF NOT EXISTS "EmailMessage_rfcMessageId_idx" ON "EmailMessage"("rfcMessageId");
