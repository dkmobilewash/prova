-- Step 0 of the AI plan: a per-company switch, a separate ingestion meter, and
-- spend that can be attributed to a project and a prompt version.
--
-- FULLY ADDITIVE. One enum, one table, four columns, two indexes, two foreign
-- keys. Nothing is dropped, nothing is rewritten, and no existing row changes
-- meaning — so the expand/contract window this repo has an outage scar for does
-- not arise: the running build simply does not select any of it.
--
-- `aiEnabled` DEFAULTS TRUE, and that is the one default here worth arguing
-- about. Defaulting false looks safer and would switch the assistant off for
-- every existing company the moment this applies — a product that stops working
-- after a deploy with nothing on screen saying why. Off is a decision somebody
-- makes, not a state they inherit.
--
-- `planSheetsUsed` and `failedPlanSheets` meter plan-set ingestion SEPARATELY
-- from `pagesUsed`. One 300-sheet drawing set is 300 pages, which is the whole
-- of the existing monthly page allowance — so without a third unit, uploading a
-- drawing set would leave a contractor no document allowance for the compliance
-- paperwork the same job needs.
--
-- `CompanyAiSettings` is a RESTRICT child of `Company` and carries no `jobId`,
-- so the scratch cleanup scripts have nothing to do here: they delete rows
-- under `Job` and `Contact` and never touch `Company`. Same shape as `AskUsage`
-- and `AskAllowancePeriod`, which are likewise absent from them.
--
-- `AskUsage.jobId` is a plain column and NOT a foreign key, deliberately. This
-- table is an append-only spend ledger; a job deleted in cleanup must not take
-- its billing history with it, and `ON DELETE SET NULL` would erase the
-- attribution rather than keep it. What was spent is a fact about the past.
-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('ASK', 'WIP_NARRATIVE', 'COMPLIANCE_EXTRACT', 'DRAFT_ESTIMATE_LINES', 'BID_RESEARCH', 'LEAD_SEARCH', 'PLAN_INGESTION');

-- AlterTable
ALTER TABLE "AskAllowancePeriod" ADD COLUMN     "failedPlanSheets" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "planSheetsUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AskUsage" ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "promptVersion" TEXT;

-- CreateTable
CREATE TABLE "CompanyAiSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledFeatures" "AiFeature"[],
    "planSheetsPerMonth" INTEGER NOT NULL DEFAULT 1500,
    "modelOverride" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAiSettings_companyId_key" ON "CompanyAiSettings"("companyId");

-- CreateIndex
CREATE INDEX "CompanyAiSettings_updatedByUserId_idx" ON "CompanyAiSettings"("updatedByUserId");

-- CreateIndex
CREATE INDEX "AskUsage_jobId_createdAt_idx" ON "AskUsage"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyAiSettings" ADD CONSTRAINT "CompanyAiSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAiSettings" ADD CONSTRAINT "CompanyAiSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
