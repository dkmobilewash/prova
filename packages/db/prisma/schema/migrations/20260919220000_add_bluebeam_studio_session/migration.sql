-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'BLUEBEAM';

-- CreateTable
CREATE TABLE "BluebeamStudioSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "bluebeamSessionId" TEXT NOT NULL,
    "bluebeamSessionName" TEXT NOT NULL,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" "IntegrationSyncStatus",
    "lastSyncMessage" TEXT,

    CONSTRAINT "BluebeamStudioSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BluebeamStudioSession_jobId_key" ON "BluebeamStudioSession"("jobId");

-- CreateIndex
CREATE INDEX "BluebeamStudioSession_companyId_idx" ON "BluebeamStudioSession"("companyId");

-- AddForeignKey
ALTER TABLE "BluebeamStudioSession" ADD CONSTRAINT "BluebeamStudioSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BluebeamStudioSession" ADD CONSTRAINT "BluebeamStudioSession_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BluebeamStudioSession" ADD CONSTRAINT "BluebeamStudioSession_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
