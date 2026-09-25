-- CreateEnum
CREATE TYPE "DasComplianceElection" AS ENUM ('APPROVED_TO_TRAIN', 'WILL_COMPLY_WITH_STANDARDS', 'CAC_REGULATIONS');

-- CreateEnum
CREATE TYPE "DasTransmissionMethod" AS ENUM ('FIRST_CLASS_MAIL', 'FAX', 'EMAIL', 'HAND_DELIVERED');

-- CreateEnum
CREATE TYPE "Das142DispatchOutcome" AS ENUM ('DISPATCHED', 'UNABLE_TO_DISPATCH', 'NO_RESPONSE');

-- CreateTable
CREATE TABLE "ApprenticeshipCommittee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "craftName" TEXT NOT NULL,
    "craftClassificationId" TEXT,
    "geographicArea" TEXT NOT NULL,
    "programSponsorNumber" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "email" TEXT,
    "fax" TEXT,
    "phone" TEXT,
    "approvedToTrainUs" BOOLEAN,
    "sourceUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeshipCommittee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Das140Notice" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "craftName" TEXT NOT NULL,
    "election" "DasComplianceElection" NOT NULL,
    "contractExecutedOn" TIMESTAMP(3) NOT NULL,
    "estimatedJourneymanHours" DECIMAL(9,2),
    "estimatedApprenticeHours" DECIMAL(9,2),
    "estimatedStartOn" TIMESTAMP(3),
    "estimatedCompletionOn" TIMESTAMP(3),
    "contractAmount" DECIMAL(12,2),
    "projectIdentifier" TEXT,
    "sentOn" TIMESTAMP(3),
    "sentMethod" "DasTransmissionMethod",
    "proofNote" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Das140Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Das142Request" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "craftName" TEXT NOT NULL,
    "apprenticesRequested" INTEGER NOT NULL,
    "neededFrom" TIMESTAMP(3) NOT NULL,
    "neededTo" TIMESTAMP(3),
    "requestedOn" TIMESTAMP(3),
    "sentMethod" "DasTransmissionMethod",
    "projectIdentifier" TEXT,
    "proofNote" TEXT,
    "respondedOn" TIMESTAMP(3),
    "outcome" "Das142DispatchOutcome",
    "outcomeNote" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Das142Request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprenticeshipCommittee_companyId_idx" ON "ApprenticeshipCommittee"("companyId");

-- CreateIndex
CREATE INDEX "ApprenticeshipCommittee_craftClassificationId_idx" ON "ApprenticeshipCommittee"("craftClassificationId");

-- CreateIndex
CREATE INDEX "Das140Notice_jobId_idx" ON "Das140Notice"("jobId");

-- CreateIndex
CREATE INDEX "Das140Notice_committeeId_idx" ON "Das140Notice"("committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Das140Notice_jobId_committeeId_craftName_key" ON "Das140Notice"("jobId", "committeeId", "craftName");

-- CreateIndex
CREATE INDEX "Das142Request_jobId_idx" ON "Das142Request"("jobId");

-- CreateIndex
CREATE INDEX "Das142Request_committeeId_idx" ON "Das142Request"("committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Das142Request_jobId_committeeId_craftName_neededFrom_key" ON "Das142Request"("jobId", "committeeId", "craftName", "neededFrom");

-- AddForeignKey
ALTER TABLE "ApprenticeshipCommittee" ADD CONSTRAINT "ApprenticeshipCommittee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeshipCommittee" ADD CONSTRAINT "ApprenticeshipCommittee_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Das140Notice" ADD CONSTRAINT "Das140Notice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Das140Notice" ADD CONSTRAINT "Das140Notice_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "ApprenticeshipCommittee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Das142Request" ADD CONSTRAINT "Das142Request_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Das142Request" ADD CONSTRAINT "Das142Request_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "ApprenticeshipCommittee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

