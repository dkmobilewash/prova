-- CreateEnum
CREATE TYPE "IncidentOutcome" AS ENUM ('DEATH', 'DAYS_AWAY', 'RESTRICTED_OR_TRANSFER', 'OTHER_RECORDABLE', 'FIRST_AID_ONLY');

-- CreateEnum
CREATE TYPE "IncidentClassification" AS ENUM ('INJURY', 'SKIN_DISORDER', 'RESPIRATORY_CONDITION', 'POISONING', 'HEARING_LOSS', 'OTHER_ILLNESS');

-- CreateTable
CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "caseNumber" INTEGER NOT NULL,
    "caseYear" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "employeeName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "classification" "IncidentClassification" NOT NULL,
    "outcome" "IncidentOutcome" NOT NULL,
    "daysAway" INTEGER,
    "daysRestricted" INTEGER,
    "reportedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolboxTalk" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "heldOn" TIMESTAMP(3) NOT NULL,
    "topic" TEXT NOT NULL,
    "presenter" TEXT,
    "attendees" TEXT,
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolboxTalk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyIncident_companyId_idx" ON "SafetyIncident"("companyId");

-- CreateIndex
CREATE INDEX "SafetyIncident_jobId_idx" ON "SafetyIncident"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyIncident_companyId_caseYear_caseNumber_key" ON "SafetyIncident"("companyId", "caseYear", "caseNumber");

-- CreateIndex
CREATE INDEX "ToolboxTalk_companyId_idx" ON "ToolboxTalk"("companyId");

-- CreateIndex
CREATE INDEX "ToolboxTalk_jobId_idx" ON "ToolboxTalk"("jobId");

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolboxTalk" ADD CONSTRAINT "ToolboxTalk_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolboxTalk" ADD CONSTRAINT "ToolboxTalk_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolboxTalk" ADD CONSTRAINT "ToolboxTalk_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
