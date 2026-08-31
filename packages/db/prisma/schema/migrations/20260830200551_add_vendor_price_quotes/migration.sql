-- CreateEnum
CREATE TYPE "VendorPriceSource" AS ENUM ('QUOTE', 'INVOICE', 'PRICE_LIST', 'VERBAL');

-- CreateTable
CREATE TABLE "VendorPriceQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "catalogEntryId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quotedOn" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "source" "VendorPriceSource" NOT NULL DEFAULT 'QUOTE',
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPriceQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorPriceQuote_companyId_idx" ON "VendorPriceQuote"("companyId");

-- CreateIndex
CREATE INDEX "VendorPriceQuote_vendorId_idx" ON "VendorPriceQuote"("vendorId");

-- CreateIndex
CREATE INDEX "VendorPriceQuote_catalogEntryId_idx" ON "VendorPriceQuote"("catalogEntryId");

-- AddForeignKey
ALTER TABLE "VendorPriceQuote" ADD CONSTRAINT "VendorPriceQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPriceQuote" ADD CONSTRAINT "VendorPriceQuote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPriceQuote" ADD CONSTRAINT "VendorPriceQuote_catalogEntryId_fkey" FOREIGN KEY ("catalogEntryId") REFERENCES "LineItemCatalogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPriceQuote" ADD CONSTRAINT "VendorPriceQuote_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
