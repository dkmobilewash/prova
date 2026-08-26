-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "perDiemAmount" DECIMAL(10,2),
ADD COLUMN     "travelPayAmount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "DispatchSlip" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employeeUserId" TEXT NOT NULL,
    "craftClassificationId" TEXT,
    "dispatchNumber" TEXT,
    "dispatchDate" TIMESTAMP(3) NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchSlip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchSlip_jobId_idx" ON "DispatchSlip"("jobId");

-- CreateIndex
CREATE INDEX "DispatchSlip_employeeUserId_idx" ON "DispatchSlip"("employeeUserId");

-- CreateIndex
CREATE INDEX "DispatchSlip_craftClassificationId_idx" ON "DispatchSlip"("craftClassificationId");

-- AddForeignKey
ALTER TABLE "DispatchSlip" ADD CONSTRAINT "DispatchSlip_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchSlip" ADD CONSTRAINT "DispatchSlip_employeeUserId_fkey" FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchSlip" ADD CONSTRAINT "DispatchSlip_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
