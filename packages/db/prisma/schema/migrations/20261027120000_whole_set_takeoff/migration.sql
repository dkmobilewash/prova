-- Whole-set takeoff: "Find walls on every floor plan", behind a per-company
-- switch that is OFF. ADDITIVE ONLY: one enum value, one nullable column, one
-- boolean with a default — nothing the running build reads changes shape
-- (CLAUDE.md, the expand-then-contract entry).
--
-- The enum value is used by nothing below: Postgres refuses a new enum value
-- USED in the transaction that added it.

ALTER TYPE "PlanIngestStage" ADD VALUE 'WALLS';

-- What a finished WALLS task has to say about its sheet. Null elsewhere.
ALTER TABLE "PlanIngestTask" ADD COLUMN "note" TEXT;

ALTER TABLE "Company" ADD COLUMN "wholeSetTakeoffOn" BOOLEAN NOT NULL DEFAULT false;
