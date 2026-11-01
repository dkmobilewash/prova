-- Additive. Nullable columns, a new enum value, and content relaxed to nullable
-- so a move to a private Blob store needs no schema change.
-- AlterEnum
ALTER TYPE "SentDocumentKind" ADD VALUE 'SUBMITTAL_PACKAGE';

-- AlterTable
ALTER TABLE "SentDocument" ADD COLUMN     "blobPathname" TEXT,
ADD COLUMN     "linkExpiresAt" TIMESTAMP(3),
ADD COLUMN     "linkToken" TEXT,
ALTER COLUMN "content" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SentDocument_linkToken_key" ON "SentDocument"("linkToken");

