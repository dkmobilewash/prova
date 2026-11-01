-- Additive. One new table and one new enum; nothing existing is altered.
-- CreateEnum
CREATE TYPE "EquipmentRateUnit" AS ENUM ('HOUR', 'DAY', 'WEEK');

-- CreateTable
CREATE TABLE "EquipmentRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "EquipmentRateUnit" NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentRate_companyId_name_idx" ON "EquipmentRate"("companyId", "name");

-- AddForeignKey
ALTER TABLE "EquipmentRate" ADD CONSTRAINT "EquipmentRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

