-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "MessageEventType" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'OPENED');

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "toName" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessageEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "MessageEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "providerEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_providerMessageId_key" ON "OutboundMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_idx" ON "OutboundMessage"("companyId");

-- CreateIndex
CREATE INDEX "OutboundMessage_jobId_idx" ON "OutboundMessage"("jobId");

-- CreateIndex
CREATE INDEX "OutboundMessage_relatedType_relatedId_idx" ON "OutboundMessage"("relatedType", "relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessageEvent_providerEventId_key" ON "OutboundMessageEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_messageId_idx" ON "OutboundMessageEvent"("messageId");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_occurredAt_idx" ON "OutboundMessageEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessageEvent" ADD CONSTRAINT "OutboundMessageEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
