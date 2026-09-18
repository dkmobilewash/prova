-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'JOBBER';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "jobberId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "jobberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_jobberId_key" ON "Contact"("companyId", "jobberId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_jobberId_key" ON "Job"("companyId", "jobberId");

