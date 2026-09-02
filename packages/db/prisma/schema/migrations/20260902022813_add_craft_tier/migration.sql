-- CreateEnum
CREATE TYPE "CraftTier" AS ENUM ('JOURNEYMAN', 'APPRENTICE', 'FOREMAN');

-- AlterTable
ALTER TABLE "CraftClassification" ADD COLUMN     "apprenticePeriod" INTEGER,
ADD COLUMN     "tier" "CraftTier";
