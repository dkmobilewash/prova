-- Additive. One new table; nothing existing is altered.
-- CreateTable
CREATE TABLE "DailyReportInstalledQuantity" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReportInstalledQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReportInstalledQuantity_lineItemId_idx" ON "DailyReportInstalledQuantity"("lineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportInstalledQuantity_reportId_lineItemId_key" ON "DailyReportInstalledQuantity"("reportId", "lineItemId");

-- AddForeignKey
ALTER TABLE "DailyReportInstalledQuantity" ADD CONSTRAINT "DailyReportInstalledQuantity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyFieldReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportInstalledQuantity" ADD CONSTRAINT "DailyReportInstalledQuantity_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "JobLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

