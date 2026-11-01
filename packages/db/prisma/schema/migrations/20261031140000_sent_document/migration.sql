-- Additive. One new table and one new enum; nothing existing is altered.
-- CreateEnum
CREATE TYPE "SentDocumentKind" AS ENUM ('PURCHASE_ORDER', 'PAY_APPLICATION');

-- CreateTable
CREATE TABLE "SentDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "SentDocumentKind" NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "sentOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SentDocument_messageId_key" ON "SentDocument"("messageId");

-- CreateIndex
CREATE INDEX "SentDocument_kind_documentId_idx" ON "SentDocument"("kind", "documentId");

-- CreateIndex
CREATE INDEX "SentDocument_jobId_idx" ON "SentDocument"("jobId");

-- CreateIndex
CREATE INDEX "SentDocument_companyId_idx" ON "SentDocument"("companyId");

-- AddForeignKey
ALTER TABLE "SentDocument" ADD CONSTRAINT "SentDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentDocument" ADD CONSTRAINT "SentDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentDocument" ADD CONSTRAINT "SentDocument_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

