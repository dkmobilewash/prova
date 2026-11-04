-- Plan comparison: the company switch (OFF) and a person's override of a sheet's demolition-plan pairing.
-- Additive only: three nullable or defaulted columns, no data rewritten.
ALTER TABLE "Company" ADD COLUMN "planCompareOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TakeoffPlanPage" ADD COLUMN "priorPage" INTEGER;
ALTER TABLE "TakeoffPlanPage" ADD COLUMN "priorPageChoice" TEXT;
