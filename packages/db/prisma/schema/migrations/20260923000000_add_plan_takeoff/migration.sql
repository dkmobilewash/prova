-- CreateEnum
CREATE TYPE "TakeoffMeasurementKind" AS ENUM ('LINEAR', 'AREA', 'COUNT');

-- CreateTable
CREATE TABLE "TakeoffPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffPlanPage" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "label" TEXT,
    "pageWidthPt" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffPlanPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffScaleCalibration" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "x1" DOUBLE PRECISION NOT NULL,
    "y1" DOUBLE PRECISION NOT NULL,
    "x2" DOUBLE PRECISION NOT NULL,
    "y2" DOUBLE PRECISION NOT NULL,
    "declaredDistanceFeet" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffScaleCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffMeasurement" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "calibrationId" TEXT NOT NULL,
    "kind" "TakeoffMeasurementKind" NOT NULL,
    "xs" DOUBLE PRECISION[],
    "ys" DOUBLE PRECISION[],
    "label" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TakeoffPlan_jobId_createdAt_idx" ON "TakeoffPlan"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "TakeoffPlan_companyId_idx" ON "TakeoffPlan"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TakeoffPlanPage_planId_pageNumber_key" ON "TakeoffPlanPage"("planId", "pageNumber");

-- CreateIndex
CREATE INDEX "TakeoffScaleCalibration_pageId_createdAt_idx" ON "TakeoffScaleCalibration"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "TakeoffMeasurement_pageId_createdAt_idx" ON "TakeoffMeasurement"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "TakeoffMeasurement_calibrationId_idx" ON "TakeoffMeasurement"("calibrationId");

-- AddForeignKey
ALTER TABLE "TakeoffPlan" ADD CONSTRAINT "TakeoffPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffPlan" ADD CONSTRAINT "TakeoffPlan_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffPlan" ADD CONSTRAINT "TakeoffPlan_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffPlanPage" ADD CONSTRAINT "TakeoffPlanPage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffScaleCalibration" ADD CONSTRAINT "TakeoffScaleCalibration_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TakeoffPlanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffScaleCalibration" ADD CONSTRAINT "TakeoffScaleCalibration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TakeoffPlanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_calibrationId_fkey" FOREIGN KEY ("calibrationId") REFERENCES "TakeoffScaleCalibration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

