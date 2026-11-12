-- D: every wall gets a height (lib/takeoff/heightsByCode.ts). Additive only: the company's default wall
-- height (null = not set, as today) and a wall measurement's own height, its source, and whether it is
-- the assumed default. Existing rows: no height, not assumed — exactly what they have now.
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultWallHeightFt" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "TakeoffMeasurement" ADD COLUMN     "heightAssumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heightFrom" TEXT,
ADD COLUMN     "heightFt" DOUBLE PRECISION;
