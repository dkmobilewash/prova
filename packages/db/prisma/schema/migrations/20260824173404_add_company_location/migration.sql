-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('HQ', 'BRANCH_YARD', 'WAREHOUSE');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "operatingLocationId" TEXT;

-- CreateTable
CREATE TABLE "CompanyLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationType" "LocationType" NOT NULL,
    "name" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "primaryContactName" TEXT,
    "primaryContactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyLocation_companyId_idx" ON "CompanyLocation"("companyId");

-- CreateIndex
CREATE INDEX "Job_operatingLocationId_idx" ON "Job"("operatingLocationId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_operatingLocationId_fkey" FOREIGN KEY ("operatingLocationId") REFERENCES "CompanyLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

