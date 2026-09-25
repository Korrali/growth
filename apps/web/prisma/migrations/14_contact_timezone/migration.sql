-- Cold email is sent inside the recipient's working hours, not New York's.
-- IANA zone derived from the Apollo country at import (lib/sending/timezone.ts);
-- null falls back to the campaign timezone. Additive and nullable.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
