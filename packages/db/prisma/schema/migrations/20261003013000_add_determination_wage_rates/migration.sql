-- CreateTable
CREATE TABLE "DeterminationWageRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "determinationId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "craftClassificationId" TEXT,
    "baseWage" DECIMAL(12,2) NOT NULL,
    "pensionRate" DECIMAL(12,2),
    "vacationRate" DECIMAL(12,2),
    "healthWelfareRate" DECIMAL(12,2),
    "trainingRate" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeterminationWageRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeterminationWageRate_determinationId_idx" ON "DeterminationWageRate"("determinationId");

-- CreateIndex
CREATE INDEX "DeterminationWageRate_companyId_idx" ON "DeterminationWageRate"("companyId");

-- CreateIndex
CREATE INDEX "DeterminationWageRate_craftClassificationId_idx" ON "DeterminationWageRate"("craftClassificationId");

-- AddForeignKey
ALTER TABLE "DeterminationWageRate" ADD CONSTRAINT "DeterminationWageRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeterminationWageRate" ADD CONSTRAINT "DeterminationWageRate_determinationId_fkey" FOREIGN KEY ("determinationId") REFERENCES "PrevailingWageDetermination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeterminationWageRate" ADD CONSTRAINT "DeterminationWageRate_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

