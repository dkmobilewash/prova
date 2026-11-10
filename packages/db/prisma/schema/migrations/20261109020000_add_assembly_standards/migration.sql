-- The company's quantity standards for the automatic estimate (additive, nullable).
ALTER TABLE "CompanyBidDefaults" ADD COLUMN "assemblyStandards" JSONB;

-- A part's factor to six places: 1/32 (square feet to 4x8 sheets) does not fit in four. Widening only;
-- every existing value is kept exactly (8 integer digits before and after).
ALTER TABLE "WallTypeComponent" ALTER COLUMN "factor" SET DATA TYPE DECIMAL(14,6);
