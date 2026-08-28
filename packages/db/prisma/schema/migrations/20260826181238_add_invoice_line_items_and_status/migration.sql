-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'DISPUTED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "status" "InvoiceStatus" NOT NULL DEFAULT 'SUBMITTED';

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "thisPeriodBilled" DECIMAL(12,2) NOT NULL,
    "materialsStoredValue" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_lineItemId_idx" ON "InvoiceLineItem"("lineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLineItem_invoiceId_lineItemId_key" ON "InvoiceLineItem"("invoiceId", "lineItemId");

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
