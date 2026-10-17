-- AI subcontract review, Phase 2: how passages of the contract stand against
-- our side of the deal (the job's proposal clauses and the scope we priced).
-- Additive only: one enum, one table, two indexes, two CASCADE foreign keys —
-- the same cascade argument as 20261017180100_add_subcontract_review. Each
-- ADD CONSTRAINT stays on one line on purpose (#224).

-- CreateEnum
CREATE TYPE "SubcontractScopeRelation" AS ENUM ('CONTRADICTS_OUR_CLAUSE', 'CARRIES_OUR_CLAUSE', 'NOT_IN_OUR_PRICED_SCOPE');

-- CreateTable
CREATE TABLE "SubcontractScopeCheck" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "relation" "SubcontractScopeRelation" NOT NULL,
    "clauseId" TEXT,
    "clauseKind" "ProposalClauseKind",
    "clauseText" TEXT,
    "quote" TEXT NOT NULL,
    "pageStart" INTEGER NOT NULL,
    "pageEnd" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractScopeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubcontractScopeCheck_sourceId_idx" ON "SubcontractScopeCheck"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractScopeCheck_reviewId_key_key" ON "SubcontractScopeCheck"("reviewId", "key");

-- AddForeignKey
ALTER TABLE "SubcontractScopeCheck" ADD CONSTRAINT "SubcontractScopeCheck_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "SubcontractReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractScopeCheck" ADD CONSTRAINT "SubcontractScopeCheck_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SubcontractReviewSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

