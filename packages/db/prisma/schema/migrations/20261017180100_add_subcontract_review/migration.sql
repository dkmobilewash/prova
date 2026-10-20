-- AI subcontract review: reviews, the files each one read, the findings that
-- survived the citation check, and a person's decision on each finding.
-- Additive only: four enums, four tables, their indexes and foreign keys. No
-- backfill — nothing exists to backfill from.
--
-- EVERY FOREIGN KEY IS CASCADE, and the schema file says why: this is per-job
-- review data with no meaning once its job or contract version is gone, and
-- CASCADE gives neither cleanup script a new RESTRICT child of Job to order.
-- Each ADD CONSTRAINT stays on ONE line on purpose — #224's hand-wrapped
-- constraint is the one `scratch-cleanup-order.test.ts`'s pattern once missed.

-- CreateEnum
CREATE TYPE "SubcontractReviewSourceRole" AS ENUM ('AGREEMENT', 'SCOPE_EXHIBIT', 'INSURANCE_EXHIBIT', 'GENERAL_CONDITIONS', 'DRAWINGS_LIST', 'OTHER_EXHIBIT');

-- CreateEnum
CREATE TYPE "SubcontractFindingCategory" AS ENUM ('PAYMENT', 'RETAINAGE', 'BILLING', 'LIQUIDATED_DAMAGES', 'INDEMNITY', 'DELAY_AND_SCHEDULE', 'NOTICE', 'TERMINATION', 'BACKCHARGE', 'WARRANTY', 'INSURANCE', 'BONDING', 'LIEN_WAIVER', 'FLOW_DOWN', 'DISPUTE', 'SAFETY_SITE_ADMIN', 'SCOPE', 'OTHER');

-- CreateEnum
CREATE TYPE "SubcontractFindingSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SubcontractFindingDecisionKind" AS ENUM ('ACCEPTED', 'DISMISSED', 'NEGOTIATED');

-- CreateTable
CREATE TABLE "SubcontractReview" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "contractDocumentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "startedByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "chunkInFlightAt" TIMESTAMP(3),
    "pagesCharged" INTEGER NOT NULL DEFAULT 0,
    "findingsDropped" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubcontractReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractReviewSource" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "role" "SubcontractReviewSourceRole" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "pageText" JSONB NOT NULL,
    "unreadPages" INTEGER[],
    "chunksTotal" INTEGER NOT NULL,
    "chunksDone" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubcontractReviewSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractFinding" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" "SubcontractFindingCategory" NOT NULL,
    "subtype" TEXT,
    "severity" "SubcontractFindingSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "pageStart" INTEGER NOT NULL,
    "pageEnd" INTEGER NOT NULL,
    "sectionRef" TEXT,
    "explanation" TEXT NOT NULL,
    "suggestedPosition" TEXT NOT NULL,
    "questionForGc" TEXT,
    "terms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractFindingDecision" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "decision" "SubcontractFindingDecisionKind" NOT NULL,
    "note" TEXT,
    "editedSeverity" "SubcontractFindingSeverity",
    "editedExplanation" TEXT,
    "editedPosition" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractFindingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubcontractReview_jobId_startedAt_idx" ON "SubcontractReview"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "SubcontractReview_contractDocumentId_idx" ON "SubcontractReview"("contractDocumentId");

-- CreateIndex
CREATE INDEX "SubcontractReviewSource_reviewId_idx" ON "SubcontractReviewSource"("reviewId");

-- CreateIndex
CREATE INDEX "SubcontractFinding_sourceId_idx" ON "SubcontractFinding"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractFinding_reviewId_key_key" ON "SubcontractFinding"("reviewId", "key");

-- CreateIndex
CREATE INDEX "SubcontractFindingDecision_jobId_idx" ON "SubcontractFindingDecision"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractFindingDecision_jobId_key_key" ON "SubcontractFindingDecision"("jobId", "key");

-- AddForeignKey
ALTER TABLE "SubcontractReview" ADD CONSTRAINT "SubcontractReview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractReview" ADD CONSTRAINT "SubcontractReview_contractDocumentId_fkey" FOREIGN KEY ("contractDocumentId") REFERENCES "ContractDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractReviewSource" ADD CONSTRAINT "SubcontractReviewSource_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "SubcontractReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractFinding" ADD CONSTRAINT "SubcontractFinding_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "SubcontractReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractFinding" ADD CONSTRAINT "SubcontractFinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SubcontractReviewSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractFindingDecision" ADD CONSTRAINT "SubcontractFindingDecision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

