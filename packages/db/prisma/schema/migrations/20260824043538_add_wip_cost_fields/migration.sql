-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "budgetedUnitCost" DECIMAL(12,2),
ADD COLUMN     "currentEstimatedUnitCost" DECIMAL(12,2),
ADD COLUMN     "estimatedCostToComplete" DECIMAL(12,2),
ALTER COLUMN "unitPrice" DROP NOT NULL;

