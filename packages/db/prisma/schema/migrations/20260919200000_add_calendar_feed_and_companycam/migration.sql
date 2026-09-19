-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'COMPANYCAM';

-- AlterTable
ALTER TABLE "JobMedia" ADD COLUMN     "companycamPhotoId" TEXT;

-- CreateTable
CREATE TABLE "CalendarFeedToken" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarFeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyCamProjectLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "companycamProjectId" TEXT NOT NULL,
    "companycamProjectName" TEXT NOT NULL,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastImportedAt" TIMESTAMP(3),
    "lastImportStatus" "IntegrationSyncStatus",
    "lastImportMessage" TEXT,

    CONSTRAINT "CompanyCamProjectLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedToken_token_key" ON "CalendarFeedToken"("token");

-- CreateIndex
CREATE INDEX "CalendarFeedToken_companyId_idx" ON "CalendarFeedToken"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedToken_companyId_userId_key" ON "CalendarFeedToken"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCamProjectLink_jobId_key" ON "CompanyCamProjectLink"("jobId");

-- CreateIndex
CREATE INDEX "CompanyCamProjectLink_companyId_idx" ON "CompanyCamProjectLink"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCamProjectLink_companyId_companycamProjectId_key" ON "CompanyCamProjectLink"("companyId", "companycamProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMedia_jobId_companycamPhotoId_key" ON "JobMedia"("jobId", "companycamPhotoId");

-- AddForeignKey
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCamProjectLink" ADD CONSTRAINT "CompanyCamProjectLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCamProjectLink" ADD CONSTRAINT "CompanyCamProjectLink_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCamProjectLink" ADD CONSTRAINT "CompanyCamProjectLink_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

