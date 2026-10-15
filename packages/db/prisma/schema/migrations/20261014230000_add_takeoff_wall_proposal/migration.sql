-- The walls the geometry FOUND on a sheet, before anybody agreed to any of them.
--
-- ADDITIVE ONLY. One new enum, one new table, two new foreign keys, one index.
-- Nothing is dropped, nothing is altered, no existing column changes type, and
-- no existing row is touched — so this is safe to apply ahead of the deploy
-- that reads it, which is the expand half of the expand/contract rule CLAUDE.md
-- records from #378. The table is simply empty until something writes to it.
--
-- BOTH FOREIGN KEYS CASCADE, AND EACH IS ON ONE LINE. Prisma's default for a
-- required relation is RESTRICT, which would be a latent bug rather than a
-- safeguard: deleting a page cascades to its calibrations AND to this table,
-- Postgres fires those constraint triggers in creation order, so a RESTRICT
-- here would see rows that are about to be deleted and block
-- `takeoffPlan.deleteMany({ jobId })` in both cleanup scripts.
--
-- The one-line formatting is not style. `scratch-cleanup-order.test.ts` derives
-- the blocking foreign keys by matching this statement, and #224's hand-wrapped
-- constraint name slipped past its pattern — the set came back 180 instead of
-- 181 and every test passed on a cleanup that could no longer delete a job.
-- The pattern takes `\s+` now and the count is asserted independently, but a
-- wrapped line here would still be a needless bet on that fix.

-- CreateEnum
CREATE TYPE "TakeoffWallProposalSource" AS ENUM ('TAG', 'REMAINDER', 'GENERAL_NOTE');

-- CreateTable
CREATE TABLE "TakeoffWallProposal" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "calibrationId" TEXT NOT NULL,
    "thicknessInches" DOUBLE PRECISION NOT NULL,
    "source" "TakeoffWallProposalSource" NOT NULL,
    "sourceLabel" TEXT,
    "namedCode" TEXT,
    "runs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffWallProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TakeoffWallProposal_pageId_calibrationId_createdAt_idx" ON "TakeoffWallProposal"("pageId", "calibrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "TakeoffWallProposal" ADD CONSTRAINT "TakeoffWallProposal_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TakeoffPlanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffWallProposal" ADD CONSTRAINT "TakeoffWallProposal_calibrationId_fkey" FOREIGN KEY ("calibrationId") REFERENCES "TakeoffScaleCalibration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
