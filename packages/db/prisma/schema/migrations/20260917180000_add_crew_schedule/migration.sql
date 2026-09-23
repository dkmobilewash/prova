-- CrewScheduleDay: who is PLANNED to be on which job, on which day.
--
-- ADDITIVE ONLY. One new table, its indexes, its foreign keys and one CHECK.
-- Nothing existing is altered, nothing is dropped, nothing becomes NOT NULL,
-- no row is read or rewritten. Safe against a database with live jobs.
--
-- NO BACKFILL, DELIBERATELY. A past day's plan cannot be recovered from the
-- hours that were logged against it — hours prove somebody WAS there, and
-- this table is a statement about who was EXPECTED to be. Inventing rows
-- from TimeEntry would make every historic day retroactively "as planned",
-- which is the one answer this table exists to stop being assumed.
--
-- Hand-written rather than generated, on single lines, because `prisma
-- migrate dev` cannot run against ep-icy-hat at all (it reports
-- 20260831060000_add_equipment_assignment_history as applied to the database
-- and absent from the repo, and only offers to RESET). Single lines because
-- scratch-cleanup-order.test.ts counts "FOREIGN KEY" occurrences against
-- what its pattern parses, and a wrapped constraint is the exact shape that
-- silently shrank that set once before.

-- CreateTable
CREATE TABLE "CrewScheduleDay" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "scheduledUserId" TEXT,
    "crewMemberId" TEXT,
    "craftClassificationId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewScheduleDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrewScheduleDay_companyId_idx" ON "CrewScheduleDay"("companyId");

-- CreateIndex
CREATE INDEX "CrewScheduleDay_jobId_workDate_idx" ON "CrewScheduleDay"("jobId", "workDate");

-- CreateIndex
CREATE INDEX "CrewScheduleDay_workDate_idx" ON "CrewScheduleDay"("workDate");

-- CreateIndex
CREATE INDEX "CrewScheduleDay_scheduledUserId_idx" ON "CrewScheduleDay"("scheduledUserId");

-- CreateIndex
CREATE INDEX "CrewScheduleDay_crewMemberId_idx" ON "CrewScheduleDay"("crewMemberId");

-- CreateIndex
CREATE INDEX "CrewScheduleDay_craftClassificationId_idx" ON "CrewScheduleDay"("craftClassificationId");

-- CreateIndex
-- Postgres treats NULLs as distinct in a unique index, which is what makes
-- two keys work rather than one: every crew-member row has a NULL
-- scheduledUserId and so never collides on the first, and vice versa.
CREATE UNIQUE INDEX "CrewScheduleDay_jobId_scheduledUserId_workDate_key" ON "CrewScheduleDay"("jobId", "scheduledUserId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "CrewScheduleDay_jobId_crewMemberId_workDate_key" ON "CrewScheduleDay"("jobId", "crewMemberId", "workDate");

-- AddForeignKey
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT rather than SET NULL, and the reason is the CHECK below rather
-- than taste: nulling this column on a user delete would leave BOTH worker
-- columns null and violate the XOR, so the delete fails either way. RESTRICT
-- makes the refusal explicit instead of surfacing as a constraint error
-- nobody can read. Same choice TimeEntry made for the same two columns.
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_scheduledUserId_fkey" FOREIGN KEY ("scheduledUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL is safe here and RESTRICT would be wrong: a craft is OPTIONAL on
-- this row, so losing it leaves a valid schedule day that simply no longer
-- says what the person was planned to work as.
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The XOR: a scheduled day names a User OR a crew member, never both and
-- never neither. The same constraint TimeEntry took in
-- 20260916130010_allow_crew_time_entries, and taken here for the same
-- reason rather than by imitation: a schedule keyed on User alone cannot
-- schedule the no-login crew, which for a union sub is most of the field.
--
-- No NOT VALID / VALIDATE dance, unlike the TimeEntry one: this table is
-- brand new and empty, so there is no existing row for the CHECK to meet.
ALTER TABLE "CrewScheduleDay" ADD CONSTRAINT "CrewScheduleDay_user_or_crew" CHECK (("scheduledUserId" IS NOT NULL) <> ("crewMemberId" IS NOT NULL));
