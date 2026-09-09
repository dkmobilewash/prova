-- AlterTable
ALTER TABLE "JobMedia" ADD COLUMN     "sharedWithClientAt" TIMESTAMP(3),
ADD COLUMN     "sharedWithClientByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "JobMedia" ADD CONSTRAINT "JobMedia_sharedWithClientByUserId_fkey" FOREIGN KEY ("sharedWithClientByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
