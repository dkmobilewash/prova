-- CreateTable
CREATE TABLE "JobMediaTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMediaTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMediaTagAssignment" (
    "mediaId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "taggedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMediaTagAssignment_pkey" PRIMARY KEY ("mediaId","tagId")
);

-- CreateIndex
CREATE INDEX "JobMediaTag_companyId_idx" ON "JobMediaTag"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMediaTag_companyId_normalizedName_key" ON "JobMediaTag"("companyId", "normalizedName");

-- CreateIndex
CREATE INDEX "JobMediaTagAssignment_tagId_idx" ON "JobMediaTagAssignment"("tagId");

-- AddForeignKey
ALTER TABLE "JobMediaTag" ADD CONSTRAINT "JobMediaTag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMediaTagAssignment" ADD CONSTRAINT "JobMediaTagAssignment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "JobMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMediaTagAssignment" ADD CONSTRAINT "JobMediaTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "JobMediaTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMediaTagAssignment" ADD CONSTRAINT "JobMediaTagAssignment_taggedByUserId_fkey" FOREIGN KEY ("taggedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
