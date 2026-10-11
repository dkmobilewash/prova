-- CreateEnum
CREATE TYPE "SalesSignalKind" AS ENUM ('TRADE', 'SIZE', 'GEOGRAPHY', 'LICENCE', 'UNION', 'TECH', 'GC_RELATIONSHIP', 'PROJECT');

-- CreateEnum
CREATE TYPE "SalesSignalState" AS ENUM ('PROPOSED', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "SalesLeadSignal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" "SalesSignalKind" NOT NULL,
    "state" "SalesSignalState" NOT NULL DEFAULT 'PROPOSED',
    "claim" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceTitle" TEXT,
    "disqualifies" BOOLEAN NOT NULL DEFAULT false,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLeadSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesLeadSignal_companyId_idx" ON "SalesLeadSignal"("companyId");

-- CreateIndex
CREATE INDEX "SalesLeadSignal_leadId_idx" ON "SalesLeadSignal"("leadId");

-- CreateIndex
CREATE INDEX "SalesLeadSignal_leadId_state_idx" ON "SalesLeadSignal"("leadId", "state");

-- AddForeignKey
ALTER TABLE "SalesLeadSignal" ADD CONSTRAINT "SalesLeadSignal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLeadSignal" ADD CONSTRAINT "SalesLeadSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLeadSignal" ADD CONSTRAINT "SalesLeadSignal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

