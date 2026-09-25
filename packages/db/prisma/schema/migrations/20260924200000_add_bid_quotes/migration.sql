-- CreateTable
CREATE TABLE "BidQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bidInvitationId" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "quotedOn" TIMESTAMP(3) NOT NULL,
    "exclusions" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidQuote_bidInvitationId_packageLabel_idx" ON "BidQuote"("bidInvitationId", "packageLabel");

-- CreateIndex
CREATE INDEX "BidQuote_companyId_idx" ON "BidQuote"("companyId");

-- AddForeignKey
ALTER TABLE "BidQuote" ADD CONSTRAINT "BidQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidQuote" ADD CONSTRAINT "BidQuote_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidQuote" ADD CONSTRAINT "BidQuote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

