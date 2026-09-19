-- Photos taken on the phone can say what they were taken for, and a queued
-- upload can be retried safely.
--
-- ADDITIVE. Three nullable columns on JobMedia, two SET NULL foreign keys
-- and one partial-free unique index. No existing row is read or rewritten,
-- and nothing is locked: a photo with no attachment behaves exactly as it
-- does today.
--
-- Both attachments are SET NULL rather than CASCADE: deleting a day's report
-- or a punch item must not delete the photograph. The photo belongs to the
-- job, which is the one required parent (see media.prisma).

-- AlterTable
ALTER TABLE "JobMedia" ADD COLUMN     "clientOperationId" TEXT,
ADD COLUMN     "dailyFieldReportId" TEXT,
ADD COLUMN     "punchListItemId" TEXT;

-- CreateIndex
CREATE INDEX "JobMedia_dailyFieldReportId_idx" ON "JobMedia"("dailyFieldReportId");

-- CreateIndex
CREATE INDEX "JobMedia_punchListItemId_idx" ON "JobMedia"("punchListItemId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMedia_companyId_clientOperationId_key" ON "JobMedia"("companyId", "clientOperationId");

-- AddForeignKey
ALTER TABLE "JobMedia" ADD CONSTRAINT "JobMedia_dailyFieldReportId_fkey" FOREIGN KEY ("dailyFieldReportId") REFERENCES "DailyFieldReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMedia" ADD CONSTRAINT "JobMedia_punchListItemId_fkey" FOREIGN KEY ("punchListItemId") REFERENCES "PunchListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

