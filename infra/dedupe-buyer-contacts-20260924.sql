-- One-off cleanup after the 2026-09-24 Apollo imports.
-- Companies that ended up with two buyer contacts keep one: the contact
-- already in a sequence, else the earliest imported. The other is marked
-- isBuyer = false so auto-enroll never emails it. Only touches contacts
-- created on 2026-09-24 that are not enrolled anywhere. Expected: 24 rows.
WITH ranked AS (
  SELECT c.id, c."createdAt",
    EXISTS (SELECT 1 FROM "Outreach" o WHERE o."contactId" = c.id) AS enrolled,
    ROW_NUMBER() OVER (
      PARTITION BY c."companyId"
      ORDER BY EXISTS (SELECT 1 FROM "Outreach" o WHERE o."contactId" = c.id) DESC, c."createdAt" ASC
    ) AS rn
  FROM "Contact" c
  WHERE c."isBuyer" AND c."companyId" IS NOT NULL AND c."suppressedAt" IS NULL
)
UPDATE "Contact" SET "isBuyer" = false, "updatedAt" = now()
WHERE id IN (
  SELECT id FROM ranked
  WHERE rn > 1 AND NOT enrolled AND "createdAt" >= '2026-09-24'
);
