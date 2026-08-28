-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "reopenNote" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "supersedesId" TEXT;

-- AlterTable
ALTER TABLE "ChangeOrderProposal" ADD COLUMN     "previousIsDeleted" BOOLEAN,
ADD COLUMN     "previousQuantity" DECIMAL(12,2),
ADD COLUMN     "previousUnitPrice" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "ChangeOrder_supersedesId_idx" ON "ChangeOrder"("supersedesId");

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
