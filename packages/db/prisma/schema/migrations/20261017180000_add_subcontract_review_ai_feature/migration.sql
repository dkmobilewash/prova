-- AI subcontract review: its own per-company switch and its own monthly page
-- allowance. Additive only: one enum member and three integer columns with
-- defaults. Nothing reads or writes them until a review runs, and an unset
-- feature's default is unchanged (on).
--
-- In its own migration, ahead of the tables, because a value added by
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it.

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'SUBCONTRACT_REVIEW';

-- AlterTable
ALTER TABLE "CompanyAiSettings" ADD COLUMN     "contractPagesPerMonth" INTEGER NOT NULL DEFAULT 600;

-- AlterTable
ALTER TABLE "AskAllowancePeriod" ADD COLUMN     "contractPagesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedContractPages" INTEGER NOT NULL DEFAULT 0;
