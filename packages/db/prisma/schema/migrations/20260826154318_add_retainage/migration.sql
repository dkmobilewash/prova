-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "retainageWithheld" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "retainagePercent" DECIMAL(5,2),
ADD COLUMN     "substantialCompletionDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RetainageRelease" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetainageRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetainageRelease_jobId_idx" ON "RetainageRelease"("jobId");

-- AddForeignKey
ALTER TABLE "RetainageRelease" ADD CONSTRAINT "RetainageRelease_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetainageRelease" ADD CONSTRAINT "RetainageRelease_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
