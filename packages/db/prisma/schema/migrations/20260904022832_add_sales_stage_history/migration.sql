-- CreateTable
CREATE TABLE "SalesStageChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStage" "OpportunityStage",
    "toStage" "OpportunityStage" NOT NULL,
    "effectiveOn" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,

    CONSTRAINT "SalesStageChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesStageChange_opportunityId_idx" ON "SalesStageChange"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesStageChange_companyId_idx" ON "SalesStageChange"("companyId");

-- AddForeignKey
ALTER TABLE "SalesStageChange" ADD CONSTRAINT "SalesStageChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesStageChange" ADD CONSTRAINT "SalesStageChange_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesStageChange" ADD CONSTRAINT "SalesStageChange_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
