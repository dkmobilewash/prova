-- CreateEnum
CREATE TYPE "LienWaiverCondition" AS ENUM ('CONDITIONAL', 'UNCONDITIONAL');

-- CreateEnum
CREATE TYPE "LienWaiverStage" AS ENUM ('PROGRESS', 'FINAL');

-- CreateTable
CREATE TABLE "LienWaiver" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "condition" "LienWaiverCondition" NOT NULL,
    "stage" "LienWaiverStage" NOT NULL,
    "throughDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "exceptedAmount" DECIMAL(12,2) NOT NULL,
    "exceptionsNote" TEXT,
    "token" TEXT NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "signerName" TEXT,
    "signerEmail" TEXT,
    "signedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "snapshot" JSONB,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LienWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LienWaiver_token_key" ON "LienWaiver"("token");

-- CreateIndex
CREATE INDEX "LienWaiver_companyId_idx" ON "LienWaiver"("companyId");

-- CreateIndex
CREATE INDEX "LienWaiver_jobId_throughDate_idx" ON "LienWaiver"("jobId", "throughDate");

-- CreateIndex
CREATE INDEX "LienWaiver_invoiceId_idx" ON "LienWaiver"("invoiceId");

-- CreateIndex
CREATE INDEX "LienWaiver_createdByUserId_idx" ON "LienWaiver"("createdByUserId");

-- AddForeignKey
ALTER TABLE "LienWaiver" ADD CONSTRAINT "LienWaiver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienWaiver" ADD CONSTRAINT "LienWaiver_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienWaiver" ADD CONSTRAINT "LienWaiver_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienWaiver" ADD CONSTRAINT "LienWaiver_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

