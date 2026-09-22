-- CreateEnum
CREATE TYPE "ContractingRelationship" AS ENUM ('UNDER_GENERAL_CONTRACTORS', 'DIRECT_FOR_OWNERS', 'BOTH');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "businessScopeAskedAt" TIMESTAMP(3),
ADD COLUMN     "contractingRelationship" "ContractingRelationship",
ADD COLUMN     "doesPublicWork" BOOLEAN,
ADD COLUMN     "filesMonthlyPayApps" BOOLEAN;
