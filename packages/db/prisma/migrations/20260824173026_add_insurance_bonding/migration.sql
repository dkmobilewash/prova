-- CreateEnum
CREATE TYPE "InsurancePolicyType" AS ENUM ('GENERAL_LIABILITY', 'WORKERS_COMP', 'AUTO', 'UMBRELLA_EXCESS');

-- CreateEnum
CREATE TYPE "BondType" AS ENUM ('LICENSE_BOND', 'PERFORMANCE_PAYMENT_CAPACITY');

-- CreateTable
CREATE TABLE "CompanyInsurancePolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "policyType" "InsurancePolicyType" NOT NULL,
    "carrier" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "coverageLimits" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "defaultCertificateHolderTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBond" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "suretyName" TEXT NOT NULL,
    "bondType" "BondType" NOT NULL,
    "aggregateBondingCapacity" DECIMAL(12,2),
    "singleJobLimit" DECIMAL(12,2),
    "agentContactName" TEXT,
    "agentContactPhone" TEXT,
    "agentContactEmail" TEXT,
    "renewalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBond_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyInsurancePolicy_companyId_idx" ON "CompanyInsurancePolicy"("companyId");

-- CreateIndex
CREATE INDEX "CompanyInsurancePolicy_expirationDate_idx" ON "CompanyInsurancePolicy"("expirationDate");

-- CreateIndex
CREATE INDEX "CompanyBond_companyId_idx" ON "CompanyBond"("companyId");

-- CreateIndex
CREATE INDEX "CompanyBond_renewalDate_idx" ON "CompanyBond"("renewalDate");

-- AddForeignKey
ALTER TABLE "CompanyInsurancePolicy" ADD CONSTRAINT "CompanyInsurancePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBond" ADD CONSTRAINT "CompanyBond_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

