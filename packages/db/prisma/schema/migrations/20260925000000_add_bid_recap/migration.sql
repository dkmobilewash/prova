-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "costCategory" "CostCategory";

-- CreateTable
CREATE TABLE "JobBidRecap" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "materialMarkupPercent" DECIMAL(5,2),
    "laborMarkupPercent" DECIMAL(5,2),
    "subcontractorMarkupPercent" DECIMAL(5,2),
    "otherMarkupPercent" DECIMAL(5,2),
    "escalationPercent" DECIMAL(5,2),
    "materialTaxPercent" DECIMAL(5,2),
    "overheadPercent" DECIMAL(5,2),
    "profitPercent" DECIMAL(5,2),
    "bondPercent" DECIMAL(5,2),
    "contingencyPercent" DECIMAL(5,2),
    "appliedAt" TIMESTAMP(3),
    "appliedTotal" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobBidRecap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBidDefaults" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "materialMarkupPercent" DECIMAL(5,2),
    "laborMarkupPercent" DECIMAL(5,2),
    "subcontractorMarkupPercent" DECIMAL(5,2),
    "otherMarkupPercent" DECIMAL(5,2),
    "escalationPercent" DECIMAL(5,2),
    "materialTaxPercent" DECIMAL(5,2),
    "overheadPercent" DECIMAL(5,2),
    "profitPercent" DECIMAL(5,2),
    "bondPercent" DECIMAL(5,2),
    "contingencyPercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBidDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobBidRecap_jobId_key" ON "JobBidRecap"("jobId");

-- CreateIndex
CREATE INDEX "JobBidRecap_companyId_idx" ON "JobBidRecap"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBidDefaults_companyId_key" ON "CompanyBidDefaults"("companyId");

-- AddForeignKey
ALTER TABLE "JobBidRecap" ADD CONSTRAINT "JobBidRecap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBidRecap" ADD CONSTRAINT "JobBidRecap_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBidDefaults" ADD CONSTRAINT "CompanyBidDefaults_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
