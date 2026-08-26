-- CreateEnum
CREATE TYPE "TradeScope" AS ENUM ('METAL_FRAMING_DRYWALL', 'LATH_PLASTER', 'EIFS', 'ACOUSTICAL_CEILINGS', 'FIREPROOFING');

-- AlterTable
ALTER TABLE "CostEntry" ADD COLUMN     "tradeScope" "TradeScope";

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "tradeScope" "TradeScope";

