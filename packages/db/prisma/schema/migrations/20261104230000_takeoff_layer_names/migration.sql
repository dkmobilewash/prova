-- CreateTable
CREATE TABLE "TakeoffLayerName" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "TakeoffLayerName_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TakeoffLayerName_jobId_groupKey_key" ON "TakeoffLayerName"("jobId", "groupKey");

-- AddForeignKey
ALTER TABLE "TakeoffLayerName" ADD CONSTRAINT "TakeoffLayerName_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

