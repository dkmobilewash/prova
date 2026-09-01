-- CreateEnum
CREATE TYPE "CloseoutSubmissionStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "CloseoutSubmission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "submittedOn" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "status" "CloseoutSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "respondedOn" TIMESTAMP(3),
    "gcResponse" TEXT,
    "note" TEXT,
    "submittedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloseoutSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutSubmissionCounter" (
    "jobId" TEXT NOT NULL,
    "lastAttempt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloseoutSubmissionCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "CloseoutSubmission_companyId_idx" ON "CloseoutSubmission"("companyId");

-- CreateIndex
CREATE INDEX "CloseoutSubmission_jobId_idx" ON "CloseoutSubmission"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutSubmission_jobId_attempt_key" ON "CloseoutSubmission"("jobId", "attempt");

-- AddForeignKey
ALTER TABLE "CloseoutSubmission" ADD CONSTRAINT "CloseoutSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutSubmission" ADD CONSTRAINT "CloseoutSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutSubmission" ADD CONSTRAINT "CloseoutSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutSubmissionCounter" ADD CONSTRAINT "CloseoutSubmissionCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
