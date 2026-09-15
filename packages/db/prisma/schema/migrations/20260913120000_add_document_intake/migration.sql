-- DocumentIntake: the tray a folder of GC paperwork lands in.
--
-- ADDITIVE ONLY. One table and three types; nothing is dropped, nothing
-- existing is made non-null, and no row anywhere else is touched. There is
-- no backfill because there is nothing to backfill from — before this
-- migration these documents lived in somebody's email.
--
-- `jobId` IS NULLABLE, so Postgres holds ON DELETE SET NULL on it and this
-- table does NOT block a job delete. That is deliberate and it is checked:
-- apps/web/lib/scratch-cleanup-order.test.ts derives the blocking foreign
-- keys from this file rather than from the schema, because Prisma's
-- referential defaults differ by optionality and reading them off the schema
-- by eye is how InvoiceCounter came to block every job delete (#227).

-- CreateEnum
CREATE TYPE "DocumentIntakeKind" AS ENUM ('DRAWING', 'SUBMITTAL', 'RFI_RESPONSE', 'COMPLIANCE_DOC', 'EXECUTED_SUBCONTRACT', 'PAY_APP', 'LIEN_WAIVER', 'CERTIFIED_PAYROLL', 'PHOTO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentIntakeConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "DocumentIntakeStatus" AS ENUM ('PROPOSED', 'FILED', 'DISMISSED');

-- CreateTable
CREATE TABLE "DocumentIntake" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "blobUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "proposedKind" "DocumentIntakeKind" NOT NULL,
    "proposedConfidence" "DocumentIntakeConfidence" NOT NULL,
    "proposedReason" TEXT NOT NULL,
    "revisionHint" TEXT,
    "jobHint" TEXT,
    "acceptedKind" "DocumentIntakeKind",
    "status" "DocumentIntakeStatus" NOT NULL DEFAULT 'PROPOSED',
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentIntake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentIntake_companyId_status_createdAt_idx" ON "DocumentIntake"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentIntake_jobId_idx" ON "DocumentIntake"("jobId");

-- AddForeignKey
ALTER TABLE "DocumentIntake" ADD CONSTRAINT "DocumentIntake_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentIntake" ADD CONSTRAINT "DocumentIntake_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentIntake" ADD CONSTRAINT "DocumentIntake_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
