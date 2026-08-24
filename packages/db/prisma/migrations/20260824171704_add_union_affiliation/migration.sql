-- AlterEnum
ALTER TYPE "ComplianceDocumentType" ADD VALUE 'UNION_AGREEMENT';

-- CreateTable
CREATE TABLE "UnionLocal" (
    "id" TEXT NOT NULL,
    "parentInternational" TEXT NOT NULL,
    "localNumber" TEXT NOT NULL,
    "jurisdictionName" TEXT NOT NULL,
    "tradeJurisdiction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnionLocal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyUnionAgreement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unionLocalId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "complianceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyUnionAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftClassification" (
    "id" TEXT NOT NULL,
    "unionLocalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CraftClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FringeRateSchedule" (
    "id" TEXT NOT NULL,
    "craftClassificationId" TEXT NOT NULL,
    "baseWage" DECIMAL(12,2) NOT NULL,
    "pensionRate" DECIMAL(12,2),
    "vacationRate" DECIMAL(12,2),
    "healthWelfareRate" DECIMAL(12,2),
    "trainingRate" DECIMAL(12,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FringeRateSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeRatioRule" (
    "id" TEXT NOT NULL,
    "unionLocalId" TEXT NOT NULL,
    "apprenticeCount" INTEGER NOT NULL,
    "journeymenCount" INTEGER NOT NULL,
    "programStandardReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeRatioRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnionLocal_parentInternational_localNumber_key" ON "UnionLocal"("parentInternational", "localNumber");

-- CreateIndex
CREATE INDEX "CompanyUnionAgreement_companyId_idx" ON "CompanyUnionAgreement"("companyId");

-- CreateIndex
CREATE INDEX "CompanyUnionAgreement_unionLocalId_idx" ON "CompanyUnionAgreement"("unionLocalId");

-- CreateIndex
CREATE INDEX "CraftClassification_unionLocalId_idx" ON "CraftClassification"("unionLocalId");

-- CreateIndex
CREATE UNIQUE INDEX "CraftClassification_unionLocalId_name_key" ON "CraftClassification"("unionLocalId", "name");

-- CreateIndex
CREATE INDEX "FringeRateSchedule_craftClassificationId_idx" ON "FringeRateSchedule"("craftClassificationId");

-- CreateIndex
CREATE INDEX "FringeRateSchedule_effectiveFrom_idx" ON "FringeRateSchedule"("effectiveFrom");

-- CreateIndex
CREATE INDEX "ApprenticeRatioRule_unionLocalId_idx" ON "ApprenticeRatioRule"("unionLocalId");

-- AddForeignKey
ALTER TABLE "CompanyUnionAgreement" ADD CONSTRAINT "CompanyUnionAgreement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyUnionAgreement" ADD CONSTRAINT "CompanyUnionAgreement_unionLocalId_fkey" FOREIGN KEY ("unionLocalId") REFERENCES "UnionLocal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyUnionAgreement" ADD CONSTRAINT "CompanyUnionAgreement_complianceDocumentId_fkey" FOREIGN KEY ("complianceDocumentId") REFERENCES "ComplianceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftClassification" ADD CONSTRAINT "CraftClassification_unionLocalId_fkey" FOREIGN KEY ("unionLocalId") REFERENCES "UnionLocal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FringeRateSchedule" ADD CONSTRAINT "FringeRateSchedule_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeRatioRule" ADD CONSTRAINT "ApprenticeRatioRule_unionLocalId_fkey" FOREIGN KEY ("unionLocalId") REFERENCES "UnionLocal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent overlapping FringeRateSchedule date ranges for the same craft
-- classification at the database level. Not expressible in schema.prisma's
-- DSL (Prisma has no declarative concept of an exclusion constraint), so
-- it's hand-written here. btree_gist is a standard Postgres contrib
-- extension (bundled with Postgres itself, supported on Neon) -- required
-- for a GiST index to support equality comparisons on a plain TEXT column
-- alongside the range overlap check.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "FringeRateSchedule" ADD CONSTRAINT "FringeRateSchedule_no_overlapping_rates"
EXCLUDE USING gist (
  "craftClassificationId" WITH =,
  tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp)) WITH &&
);

