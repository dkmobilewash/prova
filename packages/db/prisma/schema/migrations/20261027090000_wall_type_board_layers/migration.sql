-- AlterTable
ALTER TABLE "WallType" ADD COLUMN     "boardLayers" INTEGER;

-- AlterTable
ALTER TABLE "WallTypeComponent" ADD COLUMN     "perLayer" BOOLEAN NOT NULL DEFAULT false;

