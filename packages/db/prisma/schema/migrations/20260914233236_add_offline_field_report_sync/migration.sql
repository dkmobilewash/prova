-- AlterTable
ALTER TABLE "DailyFieldReport" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "clientOperationId" TEXT,
ADD COLUMN     "clientUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "DailyFieldReport_companyId_clientOperationId_key" ON "DailyFieldReport"("companyId", "clientOperationId");
