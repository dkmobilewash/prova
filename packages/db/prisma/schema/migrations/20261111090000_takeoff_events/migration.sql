-- Takeoff and review-queue events, for measuring automation on real jobs (lib/takeoff/events.ts). Additive: one enum, one table.
-- CreateEnum
CREATE TYPE "TakeoffEventKind" AS ENUM ('ACCEPT', 'ACCEPT_ALL', 'PICK', 'HEIGHT_EDIT', 'SKIP', 'UNDO', 'CHANGE', 'AUTO_POST', 'SEND');

-- CreateTable
CREATE TABLE "TakeoffEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "TakeoffEventKind" NOT NULL,
    "planId" TEXT,
    "pageNumber" INTEGER,
    "target" TEXT,
    "source" TEXT,
    "batch" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TakeoffEvent_jobId_createdAt_idx" ON "TakeoffEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "TakeoffEvent_companyId_createdAt_idx" ON "TakeoffEvent"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "TakeoffEvent" ADD CONSTRAINT "TakeoffEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffEvent" ADD CONSTRAINT "TakeoffEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

