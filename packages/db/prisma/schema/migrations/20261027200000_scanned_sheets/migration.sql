-- Scanned sheets: operator counts on the inventory's row, a per-page row of
-- lines and text read off the bitmap, the RASTER ingest stage, and a company
-- switch that is OFF. ADDITIVE ONLY (CLAUDE.md, expand then contract). The
-- enum value is used by nothing below: Postgres refuses a new enum value
-- used in the transaction that added it.

ALTER TYPE "PlanIngestStage" ADD VALUE 'RASTER';

ALTER TABLE "PlanSheetText" ADD COLUMN "pathOperators" INTEGER,
ADD COLUMN "imageOperators" INTEGER;

ALTER TABLE "Company" ADD COLUMN "scannedPlansOn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PlanSheetRaster" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "dpi" INTEGER NOT NULL,
    "widthPt" DOUBLE PRECISION NOT NULL,
    "heightPt" DOUBLE PRECISION NOT NULL,
    "tiltDegrees" DOUBLE PRECISION NOT NULL,
    "lines" JSONB NOT NULL,
    "text" JSONB NOT NULL,
    "printedScale" TEXT,
    "ms" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanSheetRaster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSheetRaster_planId_pageNumber_key" ON "PlanSheetRaster"("planId", "pageNumber");

ALTER TABLE "PlanSheetRaster" ADD CONSTRAINT "PlanSheetRaster_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
