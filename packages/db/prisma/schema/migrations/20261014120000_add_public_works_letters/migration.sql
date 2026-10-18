-- The letter arm of C Stream's outbound: one row per physical letter mailed
-- (through Lob) to a firm the state says is doing certified payroll this
-- week. `signalFact` is the dedupe key — one letter per firm per public
-- fact — and `lobId` is unique so a retry can never record two mailings.
--
-- ADDITIVE ONLY: one new table and one enum, no existing table touched.
-- Not company-scoped (see public-works.prisma): rows about OTHER firms.
-- Generated schema-to-schema (`prisma migrate diff --from-schema-datamodel`),
-- no database touched.
-- CreateEnum
CREATE TYPE "PublicWorksLetterStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'RETURNED');

-- CreateTable
CREATE TABLE "PublicWorksLetter" (
    "id" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "signalFact" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" "PublicWorksLetterStatus" NOT NULL DEFAULT 'QUEUED',
    "lobId" TEXT,
    "toAddress" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "expectedDeliveryOn" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PublicWorksLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicWorksLetter_lobId_key" ON "PublicWorksLetter"("lobId");

-- CreateIndex
CREATE INDEX "PublicWorksLetter_licence_idx" ON "PublicWorksLetter"("licence");

-- CreateIndex
CREATE INDEX "PublicWorksLetter_status_queuedAt_idx" ON "PublicWorksLetter"("status", "queuedAt");

-- AddForeignKey
ALTER TABLE "PublicWorksLetter" ADD CONSTRAINT "PublicWorksLetter_licence_fkey" FOREIGN KEY ("licence") REFERENCES "PublicWorksFirm"("licence") ON DELETE CASCADE ON UPDATE CASCADE;

