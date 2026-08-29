-- CreateEnum
CREATE TYPE "WarrantyResponsibility" AS ENUM ('OURS', 'NOT_OURS', 'UNDETERMINED');

-- CreateTable
CREATE TABLE "CloseoutItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "completedOn" TIMESTAMP(3),
    "documentUrl" TEXT,
    "documentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloseoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "months" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyServiceRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reportedOn" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reportedBy" TEXT,
    "responsibility" "WarrantyResponsibility" NOT NULL DEFAULT 'UNDETERMINED',
    "resolvedOn" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloseoutItem_companyId_idx" ON "CloseoutItem"("companyId");

-- CreateIndex
CREATE INDEX "CloseoutItem_jobId_idx" ON "CloseoutItem"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutItem_jobId_name_key" ON "CloseoutItem"("jobId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyPeriod_jobId_key" ON "WarrantyPeriod"("jobId");

-- CreateIndex
CREATE INDEX "WarrantyPeriod_companyId_idx" ON "WarrantyPeriod"("companyId");

-- CreateIndex
CREATE INDEX "WarrantyServiceRequest_companyId_idx" ON "WarrantyServiceRequest"("companyId");

-- CreateIndex
CREATE INDEX "WarrantyServiceRequest_jobId_idx" ON "WarrantyServiceRequest"("jobId");

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyPeriod" ADD CONSTRAINT "WarrantyPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyPeriod" ADD CONSTRAINT "WarrantyPeriod_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyServiceRequest" ADD CONSTRAINT "WarrantyServiceRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyServiceRequest" ADD CONSTRAINT "WarrantyServiceRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyServiceRequest" ADD CONSTRAINT "WarrantyServiceRequest_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
