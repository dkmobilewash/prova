-- Correcting a certified payroll hour, without letting it change hands.
--
-- Issue #63. A logged TimeEntry had exactly one action — Remove, on a single
-- click — so fixing "10 hours" that should have been "8" meant destroying the
-- row. These rows are what a WH-347 is built from.
--
-- ADDITIVE ONLY, and the trigger at the bottom can only ever REFUSE a write.
-- Two nullable columns, one foreign key, one index. Nothing is dropped,
-- nothing becomes NOT NULL, no existing row is read or rewritten, and every
-- existing row keeps every value it has. A row nobody corrects is
-- indistinguishable from one written before this migration.

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "lastCorrectedAt" TIMESTAMP(3),
ADD COLUMN     "lastCorrectedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "TimeEntry_lastCorrectedByUserId_idx" ON "TimeEntry"("lastCorrectedByUserId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_lastCorrectedByUserId_fkey" FOREIGN KEY ("lastCorrectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written from here down: Prisma's schema language cannot express this,
-- same precedent as the EXCLUDE constraint in
-- 20260824171704_add_union_affiliation and the CrewMember identity lock in
-- 20260905183000_add_crew_members. The plpgsql below is the same shape as
-- that one, which has run on production since 5 September.
-- ---------------------------------------------------------------------------

-- THE TRIGGER THAT 20260905183000_add_crew_members DELIBERATELY DID NOT SHIP.
--
-- That migration's closing comment is the argument this one has to answer, so
-- here it is answered rather than re-derived. It removed
-- "TimeEntry_crew_member_lock" before it ever ran, because "TimeEntry" is a
-- LIVE PAYROLL TABLE and "shipping an unclicked BEFORE UPDATE trigger onto
-- live payroll is the one category of mistake here that is not an afternoon
-- to undo" — and because that model shipped unwired, so nothing would have
-- exercised the trigger before real rows met it.
--
-- The unwired half stops being true with this change. There was no update
-- path to "TimeEntry" at all until now (the census in
-- apps/web/lib/timeEntryWriteCensus.test.ts held that line, call site by call
-- site); this migration accompanies the first one, which is a correction form
-- that saves hours, pay type, note, allowances, cost code and craft. So the
-- trigger is exercised by the ordinary path the moment anybody clicks Save:
-- a correction that goes through proves the lock lets legitimate updates by,
-- which is the failure mode a trigger on live data actually has.
--
-- WHAT IT GUARANTEES. An hour, once logged, does not move. Not to another
-- person, not to another day, not to another job. Those four columns are what
-- a WH-347 line is keyed by — the project, the named person, the day worked —
-- and a row whose person or date can be rewritten after filing means the
-- filing and the data can disagree with nothing anywhere to show that they
-- ever agreed. The form does not offer those fields and the Server Action
-- refuses them with a sentence, but both of those are application code: this
-- is the only version of the rule that survives a psql prompt, a script, or
-- the next person's nested write.
--
-- "crewMemberId" is one-way: NULL -> an id is allowed (that is a row being
-- attributed for the first time, when the column is finally wired), and any
-- change after that is refused, so an attributed hour cannot be repointed at
-- a different crew member.
--
-- A misattributed entry is DELETED and re-entered, which is a two-step
-- confirm in the UI as of this change. That keeps the correction visible
-- instead of silently rewriting who worked.
CREATE OR REPLACE FUNCTION prova_time_entry_identity_lock() RETURNS trigger AS $$
BEGIN
  IF NEW."jobId"          IS DISTINCT FROM OLD."jobId"
  OR NEW."employeeUserId" IS DISTINCT FROM OLD."employeeUserId"
  OR NEW."date"           IS DISTINCT FROM OLD."date"
  THEN
    RAISE EXCEPTION
      'TimeEntry identity is locked after creation (id=%): the job, the person and the day worked cannot be corrected. Delete this entry and enter the right one.',
      OLD."id";
  END IF;

  IF OLD."crewMemberId" IS NOT NULL
  AND NEW."crewMemberId" IS DISTINCT FROM OLD."crewMemberId"
  THEN
    RAISE EXCEPTION
      'TimeEntry.crewMemberId cannot be changed once set (id=%). An hour, once attributed, does not change hands.',
      OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "TimeEntry_identity_lock" ON "TimeEntry";
CREATE TRIGGER "TimeEntry_identity_lock"
BEFORE UPDATE ON "TimeEntry"
FOR EACH ROW EXECUTE FUNCTION prova_time_entry_identity_lock();
