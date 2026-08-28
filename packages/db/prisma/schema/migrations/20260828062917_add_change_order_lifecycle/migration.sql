-- CreateEnum
CREATE TYPE "ChangeOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'VOID');

-- CreateEnum
CREATE TYPE "ChangeOrderChangeType" AS ENUM ('ADD', 'EDIT', 'REMOVE');

-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "decidedOn" TIMESTAMP(3),
ADD COLUMN     "decisionNotes" TEXT,
ADD COLUMN     "status" "ChangeOrderStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "submittedOn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChangeOrderProposal" (
    "id" TEXT NOT NULL,
    "changeOrderId" TEXT NOT NULL,
    "changeType" "ChangeOrderChangeType" NOT NULL,
    "lineItemId" TEXT,
    "description" TEXT,
    "unit" TEXT,
    "quantity" DECIMAL(12,2),
    "unitPrice" DECIMAL(12,2),
    "budgetedUnitCost" DECIMAL(12,2),
    "currentEstimatedUnitCost" DECIMAL(12,2),
    "tradeScope" "TradeScope",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeOrderProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeOrderProposal_changeOrderId_idx" ON "ChangeOrderProposal"("changeOrderId");

-- CreateIndex
CREATE INDEX "ChangeOrderProposal_lineItemId_idx" ON "ChangeOrderProposal"("lineItemId");

-- CreateIndex
CREATE INDEX "ChangeOrder_jobId_status_idx" ON "ChangeOrder"("jobId", "status");

-- AddForeignKey
ALTER TABLE "ChangeOrderProposal" ADD CONSTRAINT "ChangeOrderProposal_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeOrderProposal" ADD CONSTRAINT "ChangeOrderProposal_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every change order that already exists was created
-- already-approved and its effects were written to JobLineItem at creation
-- time (that was the whole gap this lifecycle closes). The ADD COLUMN above
-- defaults them to DRAFT, which would be wrong in two ways at once: the UI
-- would show live, budget-affecting scope as "not yet approved", and
-- approving it would re-apply changes JobLineItem already carries --
-- double-counting the contract value. They are APPROVED, and they were
-- applied when they were created.
UPDATE "ChangeOrder"
SET "status"    = 'APPROVED',
    "decidedOn" = "createdAt",
    "appliedAt" = "createdAt";
