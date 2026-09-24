-- CreateEnum
CREATE TYPE "WallComponentBasis" AS ENUM ('LINEAR_FT', 'FACE_SQFT', 'BOARDED_SQFT', 'STUDS', 'PER_RUN');

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "wallTypeComponentId" TEXT;

-- CreateTable
CREATE TABLE "WallType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultHeightFt" DECIMAL(8,2),
    "sides" INTEGER NOT NULL DEFAULT 2,
    "studSpacingIn" DECIMAL(6,2) NOT NULL DEFAULT 16,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WallType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallTypeComponent" (
    "id" TEXT NOT NULL,
    "wallTypeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "basis" "WallComponentBasis" NOT NULL,
    "factor" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "roundUp" BOOLEAN NOT NULL DEFAULT false,
    "catalogEntryId" TEXT,
    "productionRate" DECIMAL(10,4),
    "craftClassificationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WallTypeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "wallTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lengthFt" DECIMAL(10,2) NOT NULL,
    "heightFt" DECIMAL(8,2),
    "openings" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WallRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WallType_companyId_idx" ON "WallType"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WallType_companyId_code_key" ON "WallType"("companyId", "code");

-- CreateIndex
CREATE INDEX "WallTypeComponent_wallTypeId_idx" ON "WallTypeComponent"("wallTypeId");

-- CreateIndex
CREATE INDEX "WallRun_companyId_idx" ON "WallRun"("companyId");

-- CreateIndex
CREATE INDEX "WallRun_jobId_idx" ON "WallRun"("jobId");

-- CreateIndex
CREATE INDEX "WallRun_wallTypeId_idx" ON "WallRun"("wallTypeId");

-- CreateIndex
CREATE INDEX "JobLineItem_wallTypeComponentId_idx" ON "JobLineItem"("wallTypeComponentId");

-- AddForeignKey
ALTER TABLE "JobLineItem" ADD CONSTRAINT "JobLineItem_wallTypeComponentId_fkey" FOREIGN KEY ("wallTypeComponentId") REFERENCES "WallTypeComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallType" ADD CONSTRAINT "WallType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallTypeComponent" ADD CONSTRAINT "WallTypeComponent_wallTypeId_fkey" FOREIGN KEY ("wallTypeId") REFERENCES "WallType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallTypeComponent" ADD CONSTRAINT "WallTypeComponent_catalogEntryId_fkey" FOREIGN KEY ("catalogEntryId") REFERENCES "LineItemCatalogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallTypeComponent" ADD CONSTRAINT "WallTypeComponent_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallRun" ADD CONSTRAINT "WallRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallRun" ADD CONSTRAINT "WallRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallRun" ADD CONSTRAINT "WallRun_wallTypeId_fkey" FOREIGN KEY ("wallTypeId") REFERENCES "WallType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
