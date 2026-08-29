-- AlterTable
ALTER TABLE "MaterialOrder" ADD COLUMN     "lineItemId" TEXT;

-- AddForeignKey
ALTER TABLE "MaterialOrder" ADD CONSTRAINT "MaterialOrder_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
