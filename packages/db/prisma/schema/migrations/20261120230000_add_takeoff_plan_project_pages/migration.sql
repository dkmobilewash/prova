-- Additive: the project a user chose when one upload holds two projects. Empty for every existing plan (no backfill:
-- nobody has been asked yet).
ALTER TABLE "TakeoffPlan" ADD COLUMN "projectPages" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
