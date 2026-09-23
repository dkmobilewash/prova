-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "bidDueDate" TIMESTAMP(3),
ADD COLUMN     "bidResearch" JSONB,
ADD COLUMN     "projectLocation" TEXT;
