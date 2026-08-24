-- AlterTable
ALTER TABLE "ComplianceDocument" ADD COLUMN     "aiExtracted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileUrl" TEXT;
