-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'ACC';

-- CreateEnum
CREATE TYPE "AccItemKind" AS ENUM ('RFI', 'SUBMITTAL');

-- CreateTable
CREATE TABLE "AccProjectLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "accAccountId" TEXT NOT NULL,
    "accAccountName" TEXT NOT NULL,
    "accProjectId" TEXT NOT NULL,
    "accProjectName" TEXT NOT NULL,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshedAt" TIMESTAMP(3),
    "lastRefreshStatus" "IntegrationSyncStatus",
    "lastRefreshMessage" TEXT,

    CONSTRAINT "AccProjectLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" "AccItemKind" NOT NULL,
    "accId" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT,
    "revision" TEXT,
    "discipline" TEXT,
    "ballInCourt" TEXT,
    "dueDate" TIMESTAMP(3),
    "accUpdatedAt" TIMESTAMP(3),
    "webUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccProjectLink_jobId_key" ON "AccProjectLink"("jobId");

-- CreateIndex
CREATE INDEX "AccProjectLink_companyId_idx" ON "AccProjectLink"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AccProjectLink_companyId_accProjectId_key" ON "AccProjectLink"("companyId", "accProjectId");

-- CreateIndex
CREATE INDEX "AccItem_companyId_kind_idx" ON "AccItem"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AccItem_linkId_kind_accId_key" ON "AccItem"("linkId", "kind", "accId");

-- AddForeignKey
ALTER TABLE "AccProjectLink" ADD CONSTRAINT "AccProjectLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccProjectLink" ADD CONSTRAINT "AccProjectLink_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccItem" ADD CONSTRAINT "AccItem_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AccProjectLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
