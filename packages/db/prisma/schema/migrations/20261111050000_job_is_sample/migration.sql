-- A job C Stream made to show a new company the flow (lib/sample-job). Additive.
ALTER TABLE "Job" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;
