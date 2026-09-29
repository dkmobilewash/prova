-- Plan-set ingestion's two stores: what each page SAYS, and what was PROPOSED
-- about the sheet on it.
--
-- FULLY ADDITIVE — two enums, two tables, five indexes, five foreign keys, and
-- nothing dropped or altered. The running build selects none of it, so the
-- expand/contract window this repo has an outage scar for (#378) does not arise.
--
-- WHY TWO TABLES AND NOT ONE, because it looks like duplication and is not.
-- `PlanIngestJob` is one job per STAGE per plan, so `PAGE_INVENTORY` and
-- `TITLE_BLOCK` are two different job rows. A single table keyed on the ingest job
-- would put the extracted text and the proposal made from it on different rows.
-- So each is keyed by what it actually is:
--
--   `PlanSheetText`     unique on (planId, pageNumber). The text of page N of a
--                       PDF is a property of an IMMUTABLE FILE, so re-reading it
--                       produces the same words and an upsert is idempotent.
--
--   `PlanSheetProposal` unique on (ingestJobId, pageNumber). A model's output at a
--                       moment, with a prompt version. APPEND-ONLY per run: keyed
--                       on the page instead, a second TITLE_BLOCK run would
--                       overwrite a proposal an estimator had already accepted
--                       beside, which is the one thing the proposed/accepted pair
--                       exists to make answerable.
--
-- BOTH CASCADE FROM `TakeoffPlan`, which is deliberate and saves three edits:
-- that model's own comment records the trick — everything cascading from it stays
-- out of `HANDLED_MODELS` and both cleanup `del()` orders, because one
-- `takeoffPlan.deleteMany({ jobId })` reaches all of it. A per-plan child wired the
-- other way would be a RESTRICT blocker that outlives its parent's children and
-- then refuses the delete, which is the `InvoiceCounter` scar (#224/#227).
--
-- `hasTextLayer` IS A FACT, NOT A FAILURE. A scanned sheet has no vector text and
-- never will. A stage reporting that as a task failure would fail three times with
-- backoff, spend three sheet claims, and leave a row whose Retry can never
-- succeed — 900 claims and a 300-row retry list for a wholly scanned set. So it is
-- recorded, the page is never sent to a model, and the review screen asks for the
-- sheet number to be typed.
--
-- Generated with `prisma migrate diff --from-schema-datamodel --to-schema-datamodel`
-- against a copy of the committed schema. NEVER `--shadow-database-url`: that
-- drops and recreates whatever database it is handed, and on 2026-09-18 it was
-- handed a real one.


-- CreateEnum
CREATE TYPE "PlanSheetConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "PlanSheetProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlanSheetText" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "hasTextLayer" BOOLEAN NOT NULL,
    "titleBlockText" TEXT,
    "wholePageFallback" BOOLEAN NOT NULL DEFAULT false,
    "widthPt" DOUBLE PRECISION NOT NULL,
    "heightPt" DOUBLE PRECISION NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanSheetText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSheetProposal" (
    "id" TEXT NOT NULL,
    "ingestJobId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "sheetTextId" TEXT,
    "proposedSheetNumber" TEXT,
    "proposedTitle" TEXT,
    "proposedDiscipline" TEXT,
    "proposedScale" TEXT,
    "titleBlockRevisionText" TEXT,
    "titleBlockIssueDateText" TEXT,
    "proposedReason" TEXT NOT NULL,
    "proposedConfidence" "PlanSheetConfidence" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "acceptedSheetNumber" TEXT,
    "acceptedTitle" TEXT,
    "status" "PlanSheetProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanSheetProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanSheetText_planId_hasTextLayer_idx" ON "PlanSheetText"("planId", "hasTextLayer");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSheetText_planId_pageNumber_key" ON "PlanSheetText"("planId", "pageNumber");

-- CreateIndex
CREATE INDEX "PlanSheetProposal_planId_pageNumber_createdAt_idx" ON "PlanSheetProposal"("planId", "pageNumber", "createdAt");

-- CreateIndex
CREATE INDEX "PlanSheetProposal_planId_status_idx" ON "PlanSheetProposal"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSheetProposal_ingestJobId_pageNumber_key" ON "PlanSheetProposal"("ingestJobId", "pageNumber");

-- AddForeignKey
ALTER TABLE "PlanSheetText" ADD CONSTRAINT "PlanSheetText_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSheetProposal" ADD CONSTRAINT "PlanSheetProposal_ingestJobId_fkey" FOREIGN KEY ("ingestJobId") REFERENCES "PlanIngestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSheetProposal" ADD CONSTRAINT "PlanSheetProposal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSheetProposal" ADD CONSTRAINT "PlanSheetProposal_sheetTextId_fkey" FOREIGN KEY ("sheetTextId") REFERENCES "PlanSheetText"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSheetProposal" ADD CONSTRAINT "PlanSheetProposal_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

