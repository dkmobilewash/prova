-- CreateEnum
CREATE TYPE "ComplianceDocumentType" AS ENUM ('LIEN_WAIVER', 'CERTIFICATE_OF_INSURANCE', 'CERTIFIED_PAYROLL', 'UNION_FRINGE_BENEFIT_FILING');

-- CreateEnum
CREATE TYPE "ComplianceDocumentStatus" AS ENUM ('PENDING', 'RECEIVED');

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "type" "ComplianceDocumentType" NOT NULL,
    "partyName" TEXT NOT NULL,
    "status" "ComplianceDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceDocument_companyId_idx" ON "ComplianceDocument"("companyId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_jobId_idx" ON "ComplianceDocument"("jobId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_expiresAt_idx" ON "ComplianceDocument"("expiresAt");

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

