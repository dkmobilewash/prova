-- The company's production rates for estimate labor (additive, nullable; every rate starts blank).
ALTER TABLE "CompanyBidDefaults" ADD COLUMN "productionRates" JSONB;
