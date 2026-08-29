-- CreateTable
CREATE TABLE "DrawingSet" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingRevision" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "receivedOn" TIMESTAMP(3),
    "description" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DrawingSet_companyId_idx" ON "DrawingSet"("companyId");

-- CreateIndex
CREATE INDEX "DrawingSet_jobId_idx" ON "DrawingSet"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingSet_jobId_name_key" ON "DrawingSet"("jobId", "name");

-- CreateIndex
CREATE INDEX "DrawingRevision_setId_idx" ON "DrawingRevision"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingRevision_setId_label_key" ON "DrawingRevision"("setId", "label");

-- AddForeignKey
ALTER TABLE "DrawingSet" ADD CONSTRAINT "DrawingSet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingSet" ADD CONSTRAINT "DrawingSet_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_setId_fkey" FOREIGN KEY ("setId") REFERENCES "DrawingSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
