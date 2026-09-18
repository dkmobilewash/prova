-- Phase codes: a company's own cost-coding vocabulary.
--
-- ADDITIVE ONLY. One new table, one new nullable column, no data written,
-- no existing column or constraint touched. Safe to apply to a database
-- with live jobs on it: every existing JobLineItem keeps a NULL phaseCodeId
-- and reads as uncoded, which is the truth about it.
--
-- WRITTEN BY HAND rather than generated. `prisma migrate dev` refuses to run
-- against the dev database this branch was built on, because that database
-- has 20260831060000_add_equipment_assignment_history recorded while the
-- repo does not -- pre-existing drift, unrelated to this change -- and its
-- only offer is to RESET. Resetting a database to add a column is not a
-- trade anyone should take. The SQL below is what Prisma would have emitted
-- for this schema diff, in its own format and on single lines, so that the
-- foreign-key parser in apps/web/lib/scratch-cleanup-order.test.ts reads it
-- the same way it reads a generated one -- see that file's own scar about a
-- hand-written migration wrapping a line and vanishing from the census.
--
-- NO BACKFILL, deliberately. A phase code cannot be inferred from a line
-- item's description without guessing, and a guess here would file somebody
-- else's money under a code they did not choose. Uncoded lines are reported
-- as uncoded.

-- CreateTable
CREATE TABLE "PhaseCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "tracksLabor" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhaseCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhaseCode_companyId_isActive_idx" ON "PhaseCode"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseCode_companyId_code_key" ON "PhaseCode"("companyId", "code");

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "phaseCodeId" TEXT;

-- CreateIndex
CREATE INDEX "JobLineItem_phaseCodeId_idx" ON "JobLineItem"("phaseCodeId");

-- AddForeignKey
ALTER TABLE "PhaseCode" ADD CONSTRAINT "PhaseCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLineItem" ADD CONSTRAINT "JobLineItem_phaseCodeId_fkey" FOREIGN KEY ("phaseCodeId") REFERENCES "PhaseCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
