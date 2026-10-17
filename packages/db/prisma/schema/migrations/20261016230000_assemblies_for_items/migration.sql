-- ─────────────────────────────────────────────────────────────────────────
-- ASSEMBLIES FOR TAKEOFF ITEMS
-- ─────────────────────────────────────────────────────────────────────────
--
-- Additive only. Four enum values, two nullable columns, one foreign key.
-- Nothing is dropped and nothing is rewritten, so the running build is
-- unaffected until the deploy that reads them lands.
--
-- Postgres 11 and earlier cannot add more than one enum value per migration.
-- Neon runs 16 and `embedded-postgres` here is 16, so the four below are one
-- statement each in one migration, which is the ordinary modern form. If this
-- repo ever has to support an older server these become four migrations.
--
-- The index is deliberate and is not what `migrate diff` emitted: the
-- expander's hot read is "every line this takeoff wrote for this job", and
-- without it that is a sequential scan of a job's whole estimate on every
-- save.

-- AlterEnum
ALTER TYPE "WallComponentBasis" ADD VALUE 'AREA_SQFT';
ALTER TYPE "WallComponentBasis" ADD VALUE 'PERIMETER_FT';
ALTER TYPE "WallComponentBasis" ADD VALUE 'COUNT_EACH';
ALTER TYPE "WallComponentBasis" ADD VALUE 'VOLUME_CY';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "assemblyLibraryPinnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "takeoffItemId" TEXT;

-- CreateIndex
CREATE INDEX "JobLineItem_takeoffItemId_idx" ON "JobLineItem"("takeoffItemId");

-- AddForeignKey
ALTER TABLE "JobLineItem" ADD CONSTRAINT "JobLineItem_takeoffItemId_fkey" FOREIGN KEY ("takeoffItemId") REFERENCES "TakeoffItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
