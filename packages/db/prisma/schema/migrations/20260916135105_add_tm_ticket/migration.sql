-- CreateTable
CREATE TABLE "TmTicket" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "workDescription" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "signerName" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "clientOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TmTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TmTicket_companyId_idx" ON "TmTicket"("companyId");

-- CreateIndex
CREATE INDEX "TmTicket_jobId_idx" ON "TmTicket"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "TmTicket_companyId_clientOperationId_key" ON "TmTicket"("companyId", "clientOperationId");

-- AddForeignKey
ALTER TABLE "TmTicket" ADD CONSTRAINT "TmTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TmTicket" ADD CONSTRAINT "TmTicket_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TmTicket" ADD CONSTRAINT "TmTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

