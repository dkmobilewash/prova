-- AlterTable
ALTER TABLE "TakeoffMeasurement" ADD COLUMN     "wallRunId" TEXT;
-- CreateIndex
CREATE INDEX "TakeoffMeasurement_wallRunId_idx" ON "TakeoffMeasurement"("wallRunId");
-- AddForeignKey
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_wallRunId_fkey" FOREIGN KEY ("wallRunId") REFERENCES "WallRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
