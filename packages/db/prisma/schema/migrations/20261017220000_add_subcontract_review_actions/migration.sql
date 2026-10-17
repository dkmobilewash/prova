-- AI subcontract review, Phase 3: what a person does with the findings — a
-- rider draft, confirmed deadlines (read by the alerts system) and confirmed
-- insurance requirements. Additive only: five enums, three tables, their
-- indexes and foreign keys. Every row is written by a person confirming; none
-- by a review run. Job foreign keys CASCADE; the rider's link to the
-- ContractDocument it was filed as is SET NULL, so deleting that version keeps
-- the rider's text. Each ADD CONSTRAINT stays on one line (#224).

-- CreateEnum
CREATE TYPE "SubcontractRiderStatus" AS ENUM ('DRAFT', 'ATTACHED');

-- CreateEnum
CREATE TYPE "SubcontractObligationKind" AS ENUM ('NOTICE_WINDOW', 'MONTHLY_DAY', 'DATED');

-- CreateEnum
CREATE TYPE "SubcontractCoverage" AS ENUM ('GENERAL_LIABILITY', 'WORKERS_COMP', 'AUTO', 'UMBRELLA_EXCESS', 'PROFESSIONAL', 'POLLUTION', 'BUILDERS_RISK', 'OTHER');

-- CreateEnum
CREATE TYPE "SubcontractEndorsement" AS ENUM ('ADDITIONAL_INSURED', 'PRIMARY_NONCONTRIBUTORY', 'WAIVER_OF_SUBROGATION');

-- CreateTable
CREATE TABLE "SubcontractRider" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceReviewId" TEXT,
    "status" "SubcontractRiderStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceKeys" TEXT[],
    "attachedContractDocumentId" TEXT,
    "attachedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractRider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractObligation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "findingKey" TEXT,
    "quote" TEXT,
    "pageStart" INTEGER,
    "kind" "SubcontractObligationKind" NOT NULL,
    "label" TEXT NOT NULL,
    "windowHours" INTEGER,
    "windowDays" INTEGER,
    "dayOfMonth" INTEGER,
    "dueOn" TIMESTAMP(3),
    "recipient" TEXT,
    "form" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractInsuranceRequirement" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "findingKey" TEXT,
    "quote" TEXT,
    "pageStart" INTEGER,
    "coverage" "SubcontractCoverage" NOT NULL,
    "coverageLabel" TEXT,
    "limitPerOccurrence" DECIMAL(14,2),
    "limitAggregate" DECIMAL(14,2),
    "endorsements" "SubcontractEndorsement"[],
    "completedOpsYears" INTEGER,
    "notes" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractInsuranceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractRider_attachedContractDocumentId_key" ON "SubcontractRider"("attachedContractDocumentId");

-- CreateIndex
CREATE INDEX "SubcontractRider_jobId_idx" ON "SubcontractRider"("jobId");

-- CreateIndex
CREATE INDEX "SubcontractObligation_jobId_idx" ON "SubcontractObligation"("jobId");

-- CreateIndex
CREATE INDEX "SubcontractInsuranceRequirement_jobId_idx" ON "SubcontractInsuranceRequirement"("jobId");

-- AddForeignKey
ALTER TABLE "SubcontractRider" ADD CONSTRAINT "SubcontractRider_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractRider" ADD CONSTRAINT "SubcontractRider_attachedContractDocumentId_fkey" FOREIGN KEY ("attachedContractDocumentId") REFERENCES "ContractDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractObligation" ADD CONSTRAINT "SubcontractObligation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractInsuranceRequirement" ADD CONSTRAINT "SubcontractInsuranceRequirement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

