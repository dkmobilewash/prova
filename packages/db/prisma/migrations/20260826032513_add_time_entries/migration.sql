-- CreateEnum
CREATE TYPE "TimeEntryPayType" AS ENUM ('STRAIGHT', 'OVERTIME', 'DOUBLE_TIME', 'SHIFT_DIFFERENTIAL');

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "employeeUserId" TEXT NOT NULL,
    "craftClassificationId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "payType" "TimeEntryPayType" NOT NULL DEFAULT 'STRAIGHT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_jobId_idx" ON "TimeEntry"("jobId");

-- CreateIndex
CREATE INDEX "TimeEntry_lineItemId_idx" ON "TimeEntry"("lineItemId");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeUserId_idx" ON "TimeEntry"("employeeUserId");

-- CreateIndex
CREATE INDEX "TimeEntry_craftClassificationId_idx" ON "TimeEntry"("craftClassificationId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeUserId_fkey" FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
