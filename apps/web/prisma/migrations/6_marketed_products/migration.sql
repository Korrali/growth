-- Growth now markets all four products. ALTER TYPE ... ADD VALUE is append-only
-- and safe on live data; existing TRUST/REVENUE/BOTH/REJECT rows are untouched.
ALTER TYPE "FitProduct" ADD VALUE IF NOT EXISTS 'BILLCLEAR';
ALTER TYPE "FitProduct" ADD VALUE IF NOT EXISTS 'MEDSCAN';
ALTER TYPE "CampaignProduct" ADD VALUE IF NOT EXISTS 'BILLCLEAR';
ALTER TYPE "CampaignProduct" ADD VALUE IF NOT EXISTS 'MEDSCAN';
