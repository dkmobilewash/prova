-- AlterTable
ALTER TABLE "BidInvitation" ADD COLUMN     "bidAmount" DECIMAL(12,2),
ADD COLUMN     "tradeScope" "TradeScope";

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "craftClassificationId" TEXT,
ADD COLUMN     "laborHours" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "EstimateVersion" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItemCatalogEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "tradeScope" "TradeScope",
    "defaultUnitPrice" DECIMAL(12,2),
    "defaultBudgetedUnitCost" DECIMAL(12,2),
    "defaultLaborHours" DECIMAL(8,2),
    "craftClassificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineItemCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstimateVersion_jobId_idx" ON "EstimateVersion"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateVersion_jobId_versionNumber_key" ON "EstimateVersion"("jobId", "versionNumber");

-- CreateIndex
CREATE INDEX "LineItemCatalogEntry_companyId_idx" ON "LineItemCatalogEntry"("companyId");

-- CreateIndex
CREATE INDEX "LineItemCatalogEntry_craftClassificationId_idx" ON "LineItemCatalogEntry"("craftClassificationId");

-- CreateIndex
CREATE INDEX "JobLineItem_craftClassificationId_idx" ON "JobLineItem"("craftClassificationId");

-- AddForeignKey
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLineItem" ADD CONSTRAINT "JobLineItem_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemCatalogEntry" ADD CONSTRAINT "LineItemCatalogEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItemCatalogEntry" ADD CONSTRAINT "LineItemCatalogEntry_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
