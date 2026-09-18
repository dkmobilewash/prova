-- Which crafts a person can be logged under — drives the phone's craft
-- picker (a worker sees only their own crafts). See WorkerCraft in
-- labor.prisma.
--
-- ADDITIVE ONLY: one new table. No existing table, column or row is touched.
-- Every foreign key cascades, so nothing that deletes a company, craft,
-- user or crew member is newly blocked by it.

-- CreateTable
CREATE TABLE "WorkerCraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "craftClassificationId" TEXT NOT NULL,
    "userId" TEXT,
    "crewMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerCraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerCraft_companyId_idx" ON "WorkerCraft"("companyId");

-- CreateIndex
CREATE INDEX "WorkerCraft_userId_idx" ON "WorkerCraft"("userId");

-- CreateIndex
CREATE INDEX "WorkerCraft_crewMemberId_idx" ON "WorkerCraft"("crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerCraft_craftClassificationId_userId_key" ON "WorkerCraft"("craftClassificationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerCraft_craftClassificationId_crewMemberId_key" ON "WorkerCraft"("craftClassificationId", "crewMemberId");

-- AddForeignKey
ALTER TABLE "WorkerCraft" ADD CONSTRAINT "WorkerCraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCraft" ADD CONSTRAINT "WorkerCraft_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCraft" ADD CONSTRAINT "WorkerCraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCraft" ADD CONSTRAINT "WorkerCraft_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A person is a login OR a crew member, never both and never neither —
-- the same XOR as "TimeEntry_employee_or_crew".
ALTER TABLE "WorkerCraft" ADD CONSTRAINT "WorkerCraft_user_or_crew" CHECK (("userId" IS NOT NULL) <> ("crewMemberId" IS NOT NULL));
