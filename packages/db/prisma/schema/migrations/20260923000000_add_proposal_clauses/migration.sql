-- CreateEnum
CREATE TYPE "ProposalClauseKind" AS ENUM ('INCLUSION', 'EXCLUSION', 'CLARIFICATION', 'ALTERNATE');

-- CreateTable
CREATE TABLE "ProposalClause" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ProposalClauseKind" NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalClause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposalClause_companyId_idx" ON "ProposalClause"("companyId");

-- AddForeignKey
ALTER TABLE "ProposalClause" ADD CONSTRAINT "ProposalClause_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "JobProposalClause" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "ProposalClauseKind" NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobProposalClause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobProposalClause_companyId_idx" ON "JobProposalClause"("companyId");

-- CreateIndex
CREATE INDEX "JobProposalClause_jobId_idx" ON "JobProposalClause"("jobId");

-- AddForeignKey
ALTER TABLE "JobProposalClause" ADD CONSTRAINT "JobProposalClause_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobProposalClause" ADD CONSTRAINT "JobProposalClause_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
