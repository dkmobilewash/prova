-- CreateEnum
CREATE TYPE "TakeoffExclusionKind" AS ENUM ('EXCLUDE_LIKE', 'WORK_AREA');

-- CreateTable: what the user said about one sheet's walls. Additive; a table
-- of its own so it can never be summed as a measurement.
CREATE TABLE "TakeoffSheetExclusion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "kind" "TakeoffExclusionKind" NOT NULL,
    "xs" DOUBLE PRECISION[],
    "ys" DOUBLE PRECISION[],
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffSheetExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TakeoffSheetExclusion_pageId_idx" ON "TakeoffSheetExclusion"("pageId");

-- AddForeignKey
ALTER TABLE "TakeoffSheetExclusion" ADD CONSTRAINT "TakeoffSheetExclusion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TakeoffPlanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
