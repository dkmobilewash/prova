-- CreateEnum
CREATE TYPE "BidSpecFindingKind" AS ENUM ('FINISH_LEVEL', 'FIRE_RATING', 'ACOUSTIC', 'MOCK_UP', 'TESTING', 'NAMED_PRODUCT', 'ATTIC_STOCK', 'PERFORMANCE', 'GENERAL');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'SPEC_READ';

-- AlterTable
ALTER TABLE "CompanyAiSettings" ADD COLUMN     "specPagesPerMonth" INTEGER NOT NULL DEFAULT 1800;

-- AlterTable
ALTER TABLE "AskAllowancePeriod" ADD COLUMN     "failedSpecPages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "specPagesUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BidSpecSection" (
    "id" TEXT NOT NULL,
    "bidInvitationId" TEXT NOT NULL,
    "sectionNumber" TEXT NOT NULL,
    "title" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "readInFlightAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidSpecSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidSpecReading" (
    "id" TEXT NOT NULL,
    "bidSpecSectionId" TEXT NOT NULL,
    "bidInvitationId" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "readingReason" TEXT NOT NULL,
    "pagesCharged" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "startedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidSpecReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidSpecSection_bidInvitationId_sectionNumber_idx" ON "BidSpecSection"("bidInvitationId", "sectionNumber");

-- CreateIndex
CREATE INDEX "BidSpecReading_bidSpecSectionId_createdAt_idx" ON "BidSpecReading"("bidSpecSectionId", "createdAt");

-- CreateIndex
CREATE INDEX "BidSpecReading_bidInvitationId_idx" ON "BidSpecReading"("bidInvitationId");

-- AddForeignKey
ALTER TABLE "BidSpecSection" ADD CONSTRAINT "BidSpecSection_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSpecReading" ADD CONSTRAINT "BidSpecReading_bidSpecSectionId_fkey" FOREIGN KEY ("bidSpecSectionId") REFERENCES "BidSpecSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSpecReading" ADD CONSTRAINT "BidSpecReading_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSpecReading" ADD CONSTRAINT "BidSpecReading_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

