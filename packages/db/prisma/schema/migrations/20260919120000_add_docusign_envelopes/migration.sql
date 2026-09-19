-- CreateEnum
CREATE TYPE "DocuSignEnvelopeSubject" AS ENUM ('CONTRACT_SUMMARY', 'CONTRACT_DOCUMENT', 'CHANGE_ORDER');

-- CreateEnum
CREATE TYPE "DocuSignEnvelopeStatus" AS ENUM ('SENT', 'DELIVERED', 'COMPLETED', 'DECLINED', 'VOIDED');

-- CreateTable
CREATE TABLE "DocuSignEnvelope" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "subject" "DocuSignEnvelopeSubject" NOT NULL,
    "contractDocumentId" TEXT,
    "changeOrderId" TEXT,
    "envelopeId" TEXT NOT NULL,
    "docusignAccountId" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "sentSnapshot" JSONB,
    "status" "DocuSignEnvelopeStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedReason" TEXT,
    "senderTimeZone" TEXT NOT NULL,
    "signedDocumentUrl" TEXT,
    "certificateUrl" TEXT,
    "signedContractDocumentId" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocuSignEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocuSignEnvelope_envelopeId_key" ON "DocuSignEnvelope"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "DocuSignEnvelope_signedContractDocumentId_key" ON "DocuSignEnvelope"("signedContractDocumentId");

-- CreateIndex
CREATE INDEX "DocuSignEnvelope_companyId_idx" ON "DocuSignEnvelope"("companyId");

-- CreateIndex
CREATE INDEX "DocuSignEnvelope_jobId_idx" ON "DocuSignEnvelope"("jobId");

-- CreateIndex
CREATE INDEX "DocuSignEnvelope_contractDocumentId_idx" ON "DocuSignEnvelope"("contractDocumentId");

-- CreateIndex
CREATE INDEX "DocuSignEnvelope_changeOrderId_idx" ON "DocuSignEnvelope"("changeOrderId");

-- AddForeignKey
ALTER TABLE "DocuSignEnvelope" ADD CONSTRAINT "DocuSignEnvelope_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocuSignEnvelope" ADD CONSTRAINT "DocuSignEnvelope_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocuSignEnvelope" ADD CONSTRAINT "DocuSignEnvelope_contractDocumentId_fkey" FOREIGN KEY ("contractDocumentId") REFERENCES "ContractDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocuSignEnvelope" ADD CONSTRAINT "DocuSignEnvelope_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocuSignEnvelope" ADD CONSTRAINT "DocuSignEnvelope_signedContractDocumentId_fkey" FOREIGN KEY ("signedContractDocumentId") REFERENCES "ContractDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocuSignEnvelope" ADD CONSTRAINT "DocuSignEnvelope_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

