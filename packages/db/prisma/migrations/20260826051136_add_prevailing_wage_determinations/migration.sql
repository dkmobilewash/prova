-- CreateTable
CREATE TABLE "PrevailingWageDetermination" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "sourceUrl" TEXT,
    "note" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrevailingWageDetermination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrevailingWageDetermination_jobId_idx" ON "PrevailingWageDetermination"("jobId");

-- AddForeignKey
ALTER TABLE "PrevailingWageDetermination" ADD CONSTRAINT "PrevailingWageDetermination_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevailingWageDetermination" ADD CONSTRAINT "PrevailingWageDetermination_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
