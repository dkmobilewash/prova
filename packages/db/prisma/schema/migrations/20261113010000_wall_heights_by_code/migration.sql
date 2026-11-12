-- D: every wall gets a height (lib/takeoff/heightsByCode.ts). Additive only: the company's answer for a
-- wall the drawing gives no height (where its partitions usually go, and its fixed height; null = not
-- answered, as today) and a wall measurement's own height, its source, and whether it is assumed.
-- Existing rows: no height, not assumed — exactly what they have now.
-- CreateEnum
CREATE TYPE "WallHeightConvention" AS ENUM ('TO_STRUCTURE', 'CEILING_PLUS_6', 'FIXED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultWallHeightFt" DECIMAL(6,2),
ADD COLUMN     "wallHeightConvention" "WallHeightConvention";

-- AlterTable
ALTER TABLE "TakeoffMeasurement" ADD COLUMN     "heightAssumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heightFrom" TEXT,
ADD COLUMN     "heightFt" DOUBLE PRECISION;
