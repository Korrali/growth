-- Growth now also markets Data and Web (SEO content only, no outbound).
-- ALTER TYPE ... ADD VALUE is append-only and safe on live data; existing
-- rows are untouched.
ALTER TYPE "CampaignProduct" ADD VALUE IF NOT EXISTS 'DATA';
ALTER TYPE "CampaignProduct" ADD VALUE IF NOT EXISTS 'WEB';
