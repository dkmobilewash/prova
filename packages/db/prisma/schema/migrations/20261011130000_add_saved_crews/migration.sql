-- Saved crews: a named group of people the schedule form can tick in one pick.
--
-- ADDITIVE ONLY. Two new tables, their indexes, their foreign keys and one
-- CHECK. Nothing existing is altered, so the build that is live while this
-- applies cannot see it. Generated with a schema-to-schema
-- `prisma migrate diff` (no database connection); the CHECK is hand-added.

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewMembership" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "scheduledUserId" TEXT,
    "crewMemberId" TEXT,

    CONSTRAINT "CrewMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Crew_companyId_name_key" ON "Crew"("companyId", "name");

-- CreateIndex
CREATE INDEX "CrewMembership_scheduledUserId_idx" ON "CrewMembership"("scheduledUserId");

-- CreateIndex
CREATE INDEX "CrewMembership_crewMemberId_idx" ON "CrewMembership"("crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMembership_crewId_scheduledUserId_key" ON "CrewMembership"("crewId", "scheduledUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMembership_crewId_crewMemberId_key" ON "CrewMembership"("crewId", "crewMemberId");

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMembership" ADD CONSTRAINT "CrewMembership_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMembership" ADD CONSTRAINT "CrewMembership_scheduledUserId_fkey" FOREIGN KEY ("scheduledUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMembership" ADD CONSTRAINT "CrewMembership_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one kind of worker per membership — the same XOR as
-- "CrewScheduleDay_user_or_crew". The table is new and empty, so there is
-- no existing row for the CHECK to meet. CASCADE (not SET NULL) on both
-- worker columns is what keeps a parent delete from violating it.
ALTER TABLE "CrewMembership" ADD CONSTRAINT "CrewMembership_user_or_crew" CHECK (("scheduledUserId" IS NOT NULL) <> ("crewMemberId" IS NOT NULL));
