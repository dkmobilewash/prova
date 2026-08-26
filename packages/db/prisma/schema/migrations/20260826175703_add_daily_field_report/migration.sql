-- CreateTable
CREATE TABLE "DailyFieldReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "crewPresent" TEXT,
    "workPerformed" TEXT NOT NULL,
    "weather" TEXT,
    "delays" TEXT,
    "filedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyFieldReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyFieldReport_companyId_idx" ON "DailyFieldReport"("companyId");

-- CreateIndex
CREATE INDEX "DailyFieldReport_jobId_idx" ON "DailyFieldReport"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyFieldReport_jobId_reportDate_key" ON "DailyFieldReport"("jobId", "reportDate");

-- AddForeignKey
ALTER TABLE "DailyFieldReport" ADD CONSTRAINT "DailyFieldReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFieldReport" ADD CONSTRAINT "DailyFieldReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFieldReport" ADD CONSTRAINT "DailyFieldReport_filedByUserId_fkey" FOREIGN KEY ("filedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
