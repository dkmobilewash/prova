-- CreateEnum
CREATE TYPE "RfiStatus" AS ENUM ('DRAFT', 'SENT', 'ANSWERED', 'CLOSED');

-- CreateTable
CREATE TABLE "Rfi" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "drawingReference" TEXT,
    "specSection" TEXT,
    "status" "RfiStatus" NOT NULL DEFAULT 'DRAFT',
    "sentOn" TIMESTAMP(3),
    "dueBy" TIMESTAMP(3),
    "answeredOn" TIMESTAMP(3),
    "answer" TEXT,
    "costImpact" BOOLEAN NOT NULL DEFAULT false,
    "scheduleImpact" BOOLEAN NOT NULL DEFAULT false,
    "askedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfiCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RfiCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "Rfi_companyId_idx" ON "Rfi"("companyId");

-- CreateIndex
CREATE INDEX "Rfi_jobId_idx" ON "Rfi"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_jobId_number_key" ON "Rfi"("jobId", "number");

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfiCounter" ADD CONSTRAINT "RfiCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
