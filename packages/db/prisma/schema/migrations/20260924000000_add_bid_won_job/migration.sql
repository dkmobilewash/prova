-- AlterTable
ALTER TABLE "BidInvitation" ADD COLUMN     "wonJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BidInvitation_wonJobId_key" ON "BidInvitation"("wonJobId");

-- AddForeignKey
ALTER TABLE "BidInvitation" ADD CONSTRAINT "BidInvitation_wonJobId_fkey" FOREIGN KEY ("wonJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

