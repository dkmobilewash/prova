-- CreateEnum
CREATE TYPE "Wh347FringeMode" AS ENUM ('PAID_TO_PLANS', 'PAID_IN_CASH');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "contractNumber" TEXT;

-- CreateTable
CREATE TABLE "Wh347Statement" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "fringeMode" "Wh347FringeMode",
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wh347Statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wh347StatementException" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "craftName" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wh347StatementException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Wh347Statement_jobId_idx" ON "Wh347Statement"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Wh347Statement_jobId_weekStart_key" ON "Wh347Statement"("jobId", "weekStart");

-- CreateIndex
CREATE INDEX "Wh347StatementException_statementId_idx" ON "Wh347StatementException"("statementId");

-- AddForeignKey
ALTER TABLE "Wh347Statement" ADD CONSTRAINT "Wh347Statement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wh347StatementException" ADD CONSTRAINT "Wh347StatementException_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Wh347Statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

