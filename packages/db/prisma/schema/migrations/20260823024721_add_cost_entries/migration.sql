-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('LABOR', 'MATERIAL', 'SUBCONTRACTOR', 'OTHER');

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" "CostCategory" NOT NULL DEFAULT 'OTHER',
    "incurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEntry_lineItemId_idx" ON "CostEntry"("lineItemId");

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
