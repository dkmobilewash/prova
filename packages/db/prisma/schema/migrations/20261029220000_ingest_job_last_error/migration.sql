-- AlterTable: the last failure, recorded on the job itself (additive).
ALTER TABLE "PlanIngestJob" ADD COLUMN "lastError" TEXT,
ADD COLUMN "lastErrorStage" "PlanIngestStage",
ADD COLUMN "lastErrorPage" INTEGER,
ADD COLUMN "lastErrorAt" TIMESTAMP(3);
