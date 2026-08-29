-- CreateEnum
CREATE TYPE "PriceBasis" AS ENUM ('COMPANY_CATALOG', 'HISTORICAL_BID', 'GENERAL_KNOWLEDGE');

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "priceBasis" "PriceBasis",
ADD COLUMN     "sourceCatalogEntryId" TEXT;

-- CreateIndex
CREATE INDEX "JobLineItem_sourceCatalogEntryId_idx" ON "JobLineItem"("sourceCatalogEntryId");

-- AddForeignKey
ALTER TABLE "JobLineItem" ADD CONSTRAINT "JobLineItem_sourceCatalogEntryId_fkey" FOREIGN KEY ("sourceCatalogEntryId") REFERENCES "LineItemCatalogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
