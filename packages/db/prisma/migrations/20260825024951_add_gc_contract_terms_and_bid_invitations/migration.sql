-- CreateEnum
CREATE TYPE "BidInvitationStatus" AS ENUM ('INVITED', 'SUBMITTED', 'WON', 'LOST', 'DECLINED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "defaultRetainagePercent" DECIMAL(5,2),
ADD COLUMN     "paymentTermsDays" INTEGER,
ADD COLUMN     "standardFormsUsed" TEXT;

-- CreateTable
CREATE TABLE "BidInvitation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "BidInvitationStatus" NOT NULL DEFAULT 'INVITED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidInvitation_companyId_idx" ON "BidInvitation"("companyId");

-- CreateIndex
CREATE INDEX "BidInvitation_contactId_idx" ON "BidInvitation"("contactId");

-- AddForeignKey
ALTER TABLE "BidInvitation" ADD CONSTRAINT "BidInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidInvitation" ADD CONSTRAINT "BidInvitation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
