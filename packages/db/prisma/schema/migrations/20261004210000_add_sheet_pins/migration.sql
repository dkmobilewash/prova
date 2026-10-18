-- CreateEnum
CREATE TYPE "SheetPinKind" AS ENUM ('PHOTO', 'PUNCH', 'NOTE');

-- CreateTable
CREATE TABLE "SheetPage" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "label" TEXT,
    "widthPt" DOUBLE PRECISION NOT NULL,
    "heightPt" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "imageWidthPx" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetPin" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "kind" "SheetPinKind" NOT NULL,
    "mediaId" TEXT,
    "punchItemId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "clientOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetPin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SheetPage_revisionId_idx" ON "SheetPage"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetPage_revisionId_pageNumber_key" ON "SheetPage"("revisionId", "pageNumber");

-- CreateIndex
CREATE INDEX "SheetPin_pageId_idx" ON "SheetPin"("pageId");

-- CreateIndex
CREATE INDEX "SheetPin_mediaId_idx" ON "SheetPin"("mediaId");

-- CreateIndex
CREATE INDEX "SheetPin_punchItemId_idx" ON "SheetPin"("punchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetPin_companyId_clientOperationId_key" ON "SheetPin"("companyId", "clientOperationId");

-- AddForeignKey
ALTER TABLE "SheetPage" ADD CONSTRAINT "SheetPage_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "DrawingRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetPin" ADD CONSTRAINT "SheetPin_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetPin" ADD CONSTRAINT "SheetPin_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SheetPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetPin" ADD CONSTRAINT "SheetPin_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "JobMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetPin" ADD CONSTRAINT "SheetPin_punchItemId_fkey" FOREIGN KEY ("punchItemId") REFERENCES "PunchListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetPin" ADD CONSTRAINT "SheetPin_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

