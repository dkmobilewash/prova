-- CreateEnum
CREATE TYPE "QuickBooksConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'ERROR');

-- AlterTable
ALTER TABLE "QuickBooksConnection" ADD COLUMN     "status" "QuickBooksConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
ADD COLUMN     "statusAt" TIMESTAMP(3),
ADD COLUMN     "statusDetail" TEXT;

