-- CreateEnum
CREATE TYPE "BidLineKind" AS ENUM ('ALTERNATE', 'UNIT_PRICE', 'ALLOWANCE');

-- CreateTable
CREATE TABLE "BidLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bidInvitationId" TEXT NOT NULL,
    "kind" "BidLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2),
    "unit" TEXT,
    "unitPrice" DECIMAL(12,4),
    "accepted" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidLine_bidInvitationId_sortOrder_idx" ON "BidLine"("bidInvitationId", "sortOrder");

-- CreateIndex
CREATE INDEX "BidLine_companyId_idx" ON "BidLine"("companyId");

-- AddForeignKey
ALTER TABLE "BidLine" ADD CONSTRAINT "BidLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidLine" ADD CONSTRAINT "BidLine_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

