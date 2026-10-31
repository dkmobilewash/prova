-- Additive. Two new tables and two new enums for the submittal reader, and a
-- new AiFeature value. Nothing existing is altered.
-- CreateEnum
CREATE TYPE "SubmittalRequirementKind" AS ENUM ('PRODUCT_DATA', 'SHOP_DRAWINGS', 'SAMPLES', 'CERTIFICATES', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmittalProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'SUBMITTAL_READ';

-- CreateTable
CREATE TABLE "SubmittalSpecReading" (
    "id" TEXT NOT NULL,
    "bidSpecSectionId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "readingReason" TEXT NOT NULL,
    "pagesCharged" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "startedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmittalSpecReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittalProposal" (
    "id" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sectionNumber" TEXT NOT NULL,
    "kind" "SubmittalRequirementKind" NOT NULL,
    "requirement" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "sourcePageLabel" TEXT,
    "status" "SubmittalProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "submittalId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmittalProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmittalSpecReading_bidSpecSectionId_createdAt_idx" ON "SubmittalSpecReading"("bidSpecSectionId", "createdAt");

-- CreateIndex
CREATE INDEX "SubmittalSpecReading_jobId_idx" ON "SubmittalSpecReading"("jobId");

-- CreateIndex
CREATE INDEX "SubmittalProposal_jobId_status_idx" ON "SubmittalProposal"("jobId", "status");

-- CreateIndex
CREATE INDEX "SubmittalProposal_readingId_idx" ON "SubmittalProposal"("readingId");

-- CreateIndex
CREATE INDEX "SubmittalProposal_submittalId_idx" ON "SubmittalProposal"("submittalId");

-- AddForeignKey
ALTER TABLE "SubmittalSpecReading" ADD CONSTRAINT "SubmittalSpecReading_bidSpecSectionId_fkey" FOREIGN KEY ("bidSpecSectionId") REFERENCES "BidSpecSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalSpecReading" ADD CONSTRAINT "SubmittalSpecReading_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalSpecReading" ADD CONSTRAINT "SubmittalSpecReading_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalProposal" ADD CONSTRAINT "SubmittalProposal_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "SubmittalSpecReading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalProposal" ADD CONSTRAINT "SubmittalProposal_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalProposal" ADD CONSTRAINT "SubmittalProposal_submittalId_fkey" FOREIGN KEY ("submittalId") REFERENCES "Submittal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalProposal" ADD CONSTRAINT "SubmittalProposal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

