-- CreateEnum
CREATE TYPE "ReplyClass" AS ENUM ('INTERESTED', 'SEND_INFO', 'NOT_NOW', 'WRONG_PERSON', 'OUT_OF_OFFICE', 'STOP', 'HOSTILE', 'QUESTION', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "OutboundDoor" AS ENUM ('PAY_APP', 'CERTIFIED_PAYROLL', 'TAKEOFF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReplyHandling" AS ENUM ('PENDING_REVIEW', 'AUTO_SENT', 'APPROVED_SENT', 'DISMISSED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "OutboundReply" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classification" "ReplyClass" NOT NULL,
    "classifiedBy" TEXT NOT NULL,
    "door" "OutboundDoor" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "draft" TEXT,
    "draftRationale" TEXT,
    "status" "ReplyHandling" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "smartleadMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundReply_eventId_key" ON "OutboundReply"("eventId");

-- CreateIndex
CREATE INDEX "OutboundReply_companyId_status_idx" ON "OutboundReply"("companyId", "status");

-- CreateIndex
CREATE INDEX "OutboundReply_leadId_idx" ON "OutboundReply"("leadId");

-- AddForeignKey
ALTER TABLE "OutboundReply" ADD CONSTRAINT "OutboundReply_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundReply" ADD CONSTRAINT "OutboundReply_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundReply" ADD CONSTRAINT "OutboundReply_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OutboundEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

