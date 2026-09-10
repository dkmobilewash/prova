-- CreateEnum
CREATE TYPE "JobMediaAnnotationKind" AS ENUM ('ARROW', 'BOX', 'TEXT', 'MEASURE');

-- CreateTable
CREATE TABLE "JobMediaAnnotation" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" "JobMediaAnnotationKind" NOT NULL,
    "x1" DOUBLE PRECISION NOT NULL,
    "y1" DOUBLE PRECISION NOT NULL,
    "x2" DOUBLE PRECISION,
    "y2" DOUBLE PRECISION,
    "label" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMediaAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMediaAnnotation_mediaId_createdAt_idx" ON "JobMediaAnnotation"("mediaId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobMediaAnnotation" ADD CONSTRAINT "JobMediaAnnotation_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "JobMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMediaAnnotation" ADD CONSTRAINT "JobMediaAnnotation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

