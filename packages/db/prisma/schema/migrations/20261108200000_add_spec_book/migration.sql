-- AlterTable
ALTER TABLE "BidSpecSection" ADD COLUMN     "pageFrom" INTEGER,
ADD COLUMN     "pageTo" INTEGER,
ADD COLUMN     "specBookId" TEXT;

-- CreateTable
CREATE TABLE "SpecBook" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecTradeReading" (
    "id" TEXT NOT NULL,
    "bidSpecSectionId" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "readingReason" TEXT NOT NULL,
    "pagesCharged" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecTradeReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecBook_jobId_idx" ON "SpecBook"("jobId");

-- CreateIndex
CREATE INDEX "SpecTradeReading_bidSpecSectionId_createdAt_idx" ON "SpecTradeReading"("bidSpecSectionId", "createdAt");

-- CreateIndex
CREATE INDEX "BidSpecSection_specBookId_idx" ON "BidSpecSection"("specBookId");

-- AddForeignKey
ALTER TABLE "BidSpecSection" ADD CONSTRAINT "BidSpecSection_specBookId_fkey" FOREIGN KEY ("specBookId") REFERENCES "SpecBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecBook" ADD CONSTRAINT "SpecBook_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecTradeReading" ADD CONSTRAINT "SpecTradeReading_bidSpecSectionId_fkey" FOREIGN KEY ("bidSpecSectionId") REFERENCES "BidSpecSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
