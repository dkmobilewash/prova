-- Purchase orders: the priced commitment to a vendor, per job.
--
-- Written by hand, because `prisma migrate dev` cannot run against this
-- dev database (pre-existing drift: it reports
-- 20260831060000_add_equipment_assignment_history as applied but absent
-- from the repo, and its only offer is a RESET).
--
-- EVERY `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` BELOW IS ON ONE
-- LINE. A hand-written migration that wrapped one of these after the
-- constraint name vanished from the foreign-key census in
-- apps/web/lib/scratch-cleanup-order.test.ts, and both cleanup scripts
-- shipped unable to delete a job while all thirteen of its tests passed.
-- The pattern is whitespace-insensitive now, and the census counts what it
-- parsed against a literal count of "FOREIGN KEY"; neither is a reason to
-- reintroduce the formatting that broke it.
--
-- Additive only: three new tables and two new NULLABLE columns on Vendor.
-- Nothing is dropped, renamed or rewritten, and no existing column becomes
-- NOT NULL. There is no backfill and none is needed — PurchaseOrderCounter
-- numbers a table that does not exist yet, so every job legitimately starts
-- at zero and the first upsert issues 1. (Contrast InvoiceCounter, which
-- HAD to backfill from MAX(number): its table was already full.)

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "vendorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shipToAddress" TEXT,
    "paymentTerms" TEXT,
    "awardedOn" TIMESTAMP(3) NOT NULL,
    "expectedOn" TIMESTAMP(3),
    "notes" TEXT,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderCounter_pkey" PRIMARY KEY ("jobId")
);

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "vendorNumber" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "address" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_idx" ON "PurchaseOrder"("companyId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_jobId_idx" ON "PurchaseOrder"("jobId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_jobId_number_key" ON "PurchaseOrder"("jobId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_lineItemId_idx" ON "PurchaseOrderLine"("lineItemId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderCounter" ADD CONSTRAINT "PurchaseOrderCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
