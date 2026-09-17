-- Structured scope on a change order: what is excluded, what was assumed,
-- and how the labour was broken out.
--
-- ADDITIVE ONLY. One new enum, one new table, two NULLABLE columns on an
-- existing table. Nothing is dropped, renamed, made NOT NULL or rewritten,
-- so every row that exists today reads back exactly as it does now.
--
-- Written by hand: `prisma migrate dev` cannot run against this dev
-- database (it reports 20260831060000_add_equipment_assignment_history as
-- applied but absent from the repo, pre-existing drift, and its only offer
-- is a reset). Every statement is on ONE LINE on purpose --
-- apps/web/lib/scratch-cleanup-order.test.ts derives the foreign-key census
-- from this SQL, and a wrapped ALTER TABLE has already cost this repo a
-- silently shrunk set once (#224).

-- CreateEnum
CREATE TYPE "ChangeOrderScopeNoteKind" AS ENUM ('INCLUSION', 'EXCLUSION', 'ASSUMPTION', 'PRICING_BASIS');

-- CreateTable
CREATE TABLE "ChangeOrderScopeNote" (
    "id" TEXT NOT NULL,
    "changeOrderId" TEXT NOT NULL,
    "kind" "ChangeOrderScopeNoteKind" NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeOrderScopeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeOrderScopeNote_changeOrderId_idx" ON "ChangeOrderScopeNote"("changeOrderId");

-- AddForeignKey. CASCADE, matching ChangeOrderProposal: a scope note is part
-- of the document, not a record about it, so discarding a draft takes its
-- notes with it. It is deliberately NOT a RESTRICT child of Job or
-- ChangeOrder -- that shape is what broke both cleanup scripts when
-- InvoiceCounter was added (#227), and CASCADE blocks no parent delete.
ALTER TABLE "ChangeOrderScopeNote" ADD CONSTRAINT "ChangeOrderScopeNote_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable. Both nullable with no default: an existing proposal has not
-- said which side of the price it is on, and null means exactly that rather
-- than OTHER. `foremanPercent` is set only on a foreman-allowance line and
-- records the basis it was figured at, never the amount -- the amount stays
-- in quantity x unitPrice like every other priced line.
ALTER TABLE "ChangeOrderProposal" ADD COLUMN "costCategory" "CostCategory";
ALTER TABLE "ChangeOrderProposal" ADD COLUMN "foremanPercent" DECIMAL(5,2);
