-- LienDeadline: preliminary notices, mechanic's liens, stop payment notices
-- and bond claims, each with a deadline a PERSON entered.
--
-- ADDITIVE ONLY. One new enum, one new table, its indexes and its
-- constraints. Nothing existing is altered, nothing is dropped, nothing
-- becomes NOT NULL, no row is read or rewritten. Safe against a database
-- with live jobs.
--
-- NO BACKFILL, AND NO DEFAULT ON "dueOn". This app never computes a legal
-- deadline — every date in this table is entered from counsel or the
-- person's own reading of the statute — so there is nothing it could
-- honestly backfill from.
--
-- Hand-written, EVERY STATEMENT ON A SINGLE LINE, matching
-- 20260917180000_add_crew_schedule. Single lines because
-- scratch-cleanup-order.test.ts parses the constraint statements by pattern
-- and counts them against a literal count, and a wrapped statement is the
-- shape that silently shrank that set once before (#227).
--
-- "jobId" is required and RESTRICT on Job, so this table blocks a job
-- delete: HANDLED_MODELS and both cleanup scripts' del() order carry it.

-- CreateEnum
CREATE TYPE "LienDeadlineKind" AS ENUM ('PRELIMINARY_NOTICE', 'MECHANICS_LIEN', 'STOP_PAYMENT_NOTICE', 'BOND_CLAIM', 'OTHER');

-- CreateTable
CREATE TABLE "LienDeadline" ("id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "kind" "LienDeadlineKind" NOT NULL, "otherLabel" TEXT, "dueOn" TIMESTAMP(3) NOT NULL, "servedOn" TIMESTAMP(3), "recipient" TEXT, "note" TEXT, "createdByUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LienDeadline_pkey" PRIMARY KEY ("id"));

-- CreateIndex
CREATE INDEX "LienDeadline_companyId_idx" ON "LienDeadline"("companyId");

-- CreateIndex
CREATE INDEX "LienDeadline_jobId_dueOn_idx" ON "LienDeadline"("jobId", "dueOn");

-- CreateIndex
CREATE INDEX "LienDeadline_createdByUserId_idx" ON "LienDeadline"("createdByUserId");

-- AddForeignKey
ALTER TABLE "LienDeadline" ADD CONSTRAINT "LienDeadline_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienDeadline" ADD CONSTRAINT "LienDeadline_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienDeadline" ADD CONSTRAINT "LienDeadline_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
