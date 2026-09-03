-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('GENERAL_CONTRACTOR', 'DEVELOPER', 'VENDOR', 'SUBCONTRACTOR');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "accountType" "ContactType",
ADD COLUMN     "msaExpirationDate" TIMESTAMP(3),
ADD COLUMN     "prequalificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE';
