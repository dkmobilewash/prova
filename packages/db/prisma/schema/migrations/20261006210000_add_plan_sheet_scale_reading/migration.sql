-- The scale a sheet declares about itself, read off the dimensions printed on it.
-- Additive only: one table, two indexes, one cascading foreign key. Nothing is
-- dropped and nothing existing is altered, so the running build cannot see it —
-- which is the expand half of expand-then-contract.
--
-- `TakeoffScaleCalibration` is deliberately UNTOUCHED. This table holds the two
-- facts a calibration is made of — a line and a printed distance — never a
-- scale factor. See the model's own comment for why that distinction is what
-- keeps it clear of the decision #623 recorded.

-- CreateTable
CREATE TABLE "PlanSheetScaleReading" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "scaleName" TEXT,
    "x1" DOUBLE PRECISION,
    "y1" DOUBLE PRECISION,
    "x2" DOUBLE PRECISION,
    "y2" DOUBLE PRECISION,
    "declaredDistanceFeet" DECIMAL(12,4),
    "declaredText" TEXT,
    "agreedText" TEXT,
    "consideredCount" INTEGER NOT NULL DEFAULT 0,
    "inheritedError" DOUBLE PRECISION,
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanSheetScaleReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanSheetScaleReading_planId_idx" ON "PlanSheetScaleReading"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSheetScaleReading_planId_pageNumber_key" ON "PlanSheetScaleReading"("planId", "pageNumber");

-- AddForeignKey
ALTER TABLE "PlanSheetScaleReading" ADD CONSTRAINT "PlanSheetScaleReading_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
