-- Additive: the sheet(s) a user said are the plan of the work when the walls run would count nothing. Empty for every
-- existing plan (no backfill: nobody has been asked yet).
ALTER TABLE "TakeoffPlan" ADD COLUMN "planOfWorkPages" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
