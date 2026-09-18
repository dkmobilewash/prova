-- Clock capture on a time entry: the timestamps the phone recorded when an
-- interval was clocked in and out, and the unpaid break subtracted from it —
-- immutable evidence behind the authoritative `hours` figure.
--
-- ADDITIVE ONLY. Three nullable columns, and the identity-lock trigger is
-- widened to also refuse a change to the captured clock evidence, the same
-- way it refuses a reassignment of the person or the day. No existing row is
-- read or rewritten; a row logged without a clock keeps NULLs and is
-- indistinguishable from one written before this migration.

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "clockStartedAt" TIMESTAMP(3),
ADD COLUMN "clockEndedAt" TIMESTAMP(3),
ADD COLUMN "clockBreakMinutes" INTEGER;

-- Widen the lock. The trigger itself does not change — it still points at
-- prova_time_entry_identity_lock — but CREATE OR REPLACE FUNCTION swaps in
-- the wider body in place, so a psql UPDATE that rewrites a captured clock
-- time is refused exactly like a reassignment is. The clock columns are
-- full-locked (not one-way like crewMemberId): they are written once at
-- create and never corrected, because correcting the FIGURE means editing
-- `hours`, which stays authoritative and correctable.
CREATE OR REPLACE FUNCTION prova_time_entry_identity_lock() RETURNS trigger AS $$
BEGIN
  IF NEW."jobId"          IS DISTINCT FROM OLD."jobId"
  OR NEW."employeeUserId" IS DISTINCT FROM OLD."employeeUserId"
  OR NEW."date"           IS DISTINCT FROM OLD."date"
  OR NEW."clockStartedAt"    IS DISTINCT FROM OLD."clockStartedAt"
  OR NEW."clockEndedAt"      IS DISTINCT FROM OLD."clockEndedAt"
  OR NEW."clockBreakMinutes" IS DISTINCT FROM OLD."clockBreakMinutes"
  THEN
    RAISE EXCEPTION
      'TimeEntry identity and clock capture are locked after creation (id=%): the job, the person, the day worked and the captured clock times cannot be corrected. Delete this entry and enter the right one.',
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

-- Re-declare the trigger so the full lock lives in one place — the same
-- DROP + CREATE the install migration used, idempotent against an already
-- existing trigger.
DROP TRIGGER IF EXISTS "TimeEntry_identity_lock" ON "TimeEntry";
CREATE TRIGGER "TimeEntry_identity_lock"
BEFORE UPDATE ON "TimeEntry"
FOR EACH ROW EXECUTE FUNCTION prova_time_entry_identity_lock();
