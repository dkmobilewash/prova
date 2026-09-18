-- CreateEnum
CREATE TYPE "ProcoreItemKind" AS ENUM ('DRAWING', 'RFI', 'SUBMITTAL');

-- CreateTable
CREATE TABLE "ProcoreProjectLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "procoreCompanyId" TEXT NOT NULL,
    "procoreCompanyName" TEXT NOT NULL,
    "procoreProjectId" TEXT NOT NULL,
    "procoreProjectName" TEXT NOT NULL,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshedAt" TIMESTAMP(3),
    "lastRefreshStatus" "IntegrationSyncStatus",
    "lastRefreshMessage" TEXT,

    CONSTRAINT "ProcoreProjectLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcoreItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" "ProcoreItemKind" NOT NULL,
    "procoreId" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT,
    "revision" TEXT,
    "discipline" TEXT,
    "ballInCourt" TEXT,
    "dueDate" TIMESTAMP(3),
    "procoreUpdatedAt" TIMESTAMP(3),
    "webUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcoreItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcoreProjectLink_jobId_key" ON "ProcoreProjectLink"("jobId");

-- CreateIndex
CREATE INDEX "ProcoreProjectLink_companyId_idx" ON "ProcoreProjectLink"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcoreProjectLink_companyId_procoreProjectId_key" ON "ProcoreProjectLink"("companyId", "procoreProjectId");

-- CreateIndex
CREATE INDEX "ProcoreItem_companyId_kind_idx" ON "ProcoreItem"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProcoreItem_linkId_kind_procoreId_key" ON "ProcoreItem"("linkId", "kind", "procoreId");

-- AddForeignKey
ALTER TABLE "ProcoreProjectLink" ADD CONSTRAINT "ProcoreProjectLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcoreProjectLink" ADD CONSTRAINT "ProcoreProjectLink_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcoreItem" ADD CONSTRAINT "ProcoreItem_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ProcoreProjectLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

