-- CreateEnum
CREATE TYPE "BackchargeCategory" AS ENUM ('CLEANUP', 'DAMAGE_TO_OTHER_TRADES', 'COMPLETION_BY_OTHERS', 'MATERIAL_OR_EQUIPMENT_SUPPLIED', 'SUPERVISION', 'SAFETY_VIOLATION', 'SCHEDULE_DELAY', 'OTHER');

-- CreateEnum
CREATE TYPE "BackchargeStatus" AS ENUM ('RECEIVED', 'DISPUTED', 'ACCEPTED', 'SETTLED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Backcharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "gcReference" TEXT,
    "category" "BackchargeCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "claimedAmount" DECIMAL(12,2) NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "receivedOn" TIMESTAMP(3),
    "respondByDate" TIMESTAMP(3),
    "status" "BackchargeStatus" NOT NULL DEFAULT 'RECEIVED',
    "disputedOn" TIMESTAMP(3),
    "disputeReason" TEXT,
    "resolvedOn" TIMESTAMP(3),
    "resolvedAmount" DECIMAL(12,2),
    "resolutionNote" TEXT,
    "loggedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backcharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackchargeCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BackchargeCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "Backcharge_companyId_idx" ON "Backcharge"("companyId");

-- CreateIndex
CREATE INDEX "Backcharge_jobId_idx" ON "Backcharge"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Backcharge_jobId_number_key" ON "Backcharge"("jobId", "number");

-- AddForeignKey
ALTER TABLE "Backcharge" ADD CONSTRAINT "Backcharge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backcharge" ADD CONSTRAINT "Backcharge_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backcharge" ADD CONSTRAINT "Backcharge_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackchargeCounter" ADD CONSTRAINT "BackchargeCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
