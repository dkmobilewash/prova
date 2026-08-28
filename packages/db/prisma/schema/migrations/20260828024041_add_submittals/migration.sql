-- CreateEnum
CREATE TYPE "SubmittalOutcome" AS ENUM ('APPROVED', 'APPROVED_AS_NOTED', 'REVISE_AND_RESUBMIT', 'REJECTED');

-- CreateTable
CREATE TABLE "Submittal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "specSection" TEXT,
    "drawingReference" TEXT,
    "lastRevision" INTEGER NOT NULL DEFAULT 0,
    "submittedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittalRevision" (
    "id" TEXT NOT NULL,
    "submittalId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "sentOn" TIMESTAMP(3) NOT NULL,
    "dueBack" TIMESTAMP(3),
    "returnedOn" TIMESTAMP(3),
    "outcome" "SubmittalOutcome",
    "responseNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmittalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittalCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmittalCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "Submittal_companyId_idx" ON "Submittal"("companyId");

-- CreateIndex
CREATE INDEX "Submittal_jobId_idx" ON "Submittal"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Submittal_jobId_number_key" ON "Submittal"("jobId", "number");

-- CreateIndex
CREATE INDEX "SubmittalRevision_submittalId_idx" ON "SubmittalRevision"("submittalId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmittalRevision_submittalId_revisionNumber_key" ON "SubmittalRevision"("submittalId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalRevision" ADD CONSTRAINT "SubmittalRevision_submittalId_fkey" FOREIGN KEY ("submittalId") REFERENCES "Submittal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittalCounter" ADD CONSTRAINT "SubmittalCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
