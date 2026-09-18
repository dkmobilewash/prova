-- Timesheet sign-off: the foreman's drawn signature on one job's hours for one
-- day, the office's approval, and the lock that holds a signed day still.
-- Also a drawn signature on T&M tickets.
--
-- ADDITIVE. One new table, one nullable column on TmTicket, two triggers. No
-- existing row is read or rewritten. The TimeEntry trigger only refuses a
-- write on a day that has a live sign-off, and no day has one until the first
-- signature after this migration — so every existing entry stays exactly as
-- editable as it was.

-- AlterTable
ALTER TABLE "TmTicket" ADD COLUMN     "signaturePath" TEXT;

-- CreateTable
CREATE TABLE "TimesheetSignoff" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "signerName" TEXT NOT NULL,
    "signaturePath" TEXT NOT NULL,
    "signedByUserId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "totalHours" DECIMAL(7,2) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "clientOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimesheetSignoff_companyId_idx" ON "TimesheetSignoff"("companyId");

-- CreateIndex
CREATE INDEX "TimesheetSignoff_jobId_date_idx" ON "TimesheetSignoff"("jobId", "date");

-- CreateIndex
CREATE INDEX "TimesheetSignoff_signedByUserId_idx" ON "TimesheetSignoff"("signedByUserId");

-- CreateIndex
CREATE INDEX "TimesheetSignoff_approvedByUserId_idx" ON "TimesheetSignoff"("approvedByUserId");

-- CreateIndex
CREATE INDEX "TimesheetSignoff_reopenedByUserId_idx" ON "TimesheetSignoff"("reopenedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetSignoff_companyId_clientOperationId_key" ON "TimesheetSignoff"("companyId", "clientOperationId");

-- AddForeignKey
ALTER TABLE "TimesheetSignoff" ADD CONSTRAINT "TimesheetSignoff_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetSignoff" ADD CONSTRAINT "TimesheetSignoff_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetSignoff" ADD CONSTRAINT "TimesheetSignoff_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetSignoff" ADD CONSTRAINT "TimesheetSignoff_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetSignoff" ADD CONSTRAINT "TimesheetSignoff_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One LIVE sign-off per job per day. A reopened one stays as history, so the
-- uniqueness holds only among rows not yet reopened. Prisma cannot express a
-- partial index, which is why this lives here and not in labor.prisma — the
-- same precedent as Backcharge_jobId_gcReference_key.
CREATE UNIQUE INDEX "TimesheetSignoff_jobId_date_live_key" ON "TimesheetSignoff"("jobId", "date") WHERE "reopenedAt" IS NULL;

-- What was signed cannot change. Approval and reopening are each set ONCE
-- (never cleared, never moved), a reopened sign-off takes no approval, and the
-- three user ids may only be filled in once or cleared by ON DELETE SET NULL
-- when that person leaves the team.
CREATE OR REPLACE FUNCTION prova_timesheet_signoff_lock() RETURNS trigger AS $$
DECLARE
  settable text[] := ARRAY['approvedAt', 'approvedByUserId', 'reopenedAt', 'reopenedByUserId', 'reopenReason', 'signedByUserId'];
BEGIN
  IF (to_jsonb(NEW) - settable) <> (to_jsonb(OLD) - settable) THEN
    RAISE EXCEPTION 'TimesheetSignoff is locked after signing (id=%): what was signed cannot change. Reopen it and sign again.', OLD."id";
  END IF;
  IF OLD."approvedAt" IS NOT NULL AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
    RAISE EXCEPTION 'TimesheetSignoff approval is recorded once (id=%).', OLD."id";
  END IF;
  IF OLD."reopenedAt" IS NOT NULL AND (NEW."reopenedAt" IS DISTINCT FROM OLD."reopenedAt" OR NEW."reopenReason" IS DISTINCT FROM OLD."reopenReason") THEN
    RAISE EXCEPTION 'TimesheetSignoff reopening is recorded once (id=%).', OLD."id";
  END IF;
  IF OLD."reopenedAt" IS NOT NULL AND OLD."approvedAt" IS NULL AND NEW."approvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'TimesheetSignoff was reopened and cannot be approved (id=%).', OLD."id";
  END IF;
  IF (NEW."signedByUserId" IS NOT NULL AND OLD."signedByUserId" IS NOT NULL AND NEW."signedByUserId" <> OLD."signedByUserId")
  OR (NEW."approvedByUserId" IS NOT NULL AND OLD."approvedByUserId" IS NOT NULL AND NEW."approvedByUserId" <> OLD."approvedByUserId")
  OR (NEW."reopenedByUserId" IS NOT NULL AND OLD."reopenedByUserId" IS NOT NULL AND NEW."reopenedByUserId" <> OLD."reopenedByUserId") THEN
    RAISE EXCEPTION 'TimesheetSignoff cannot be reattributed to someone else (id=%).', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "TimesheetSignoff_lock" ON "TimesheetSignoff";
CREATE TRIGGER "TimesheetSignoff_lock" BEFORE UPDATE ON "TimesheetSignoff" FOR EACH ROW EXECUTE FUNCTION prova_timesheet_signoff_lock();

-- A signed day's hours are locked: no entry added, changed or removed while
-- the day has a live sign-off. The single exception is lastCorrectedByUserId
-- going NULL, which is ON DELETE SET NULL firing when the person who once
-- corrected an hour leaves the team — that is not a change to the hours, and
-- refusing it would make removing a team member fail on any signed day.
--
-- A separate function and trigger from the identity lock on purpose, and this
-- file deliberately does not name that one: lib/time-entry-correction.test.ts
-- reads the newest migration mentioning it and counts its checks.
CREATE OR REPLACE FUNCTION prova_time_entry_day_lock() RETURNS trigger AS $$
DECLARE
  target_job text;
  target_date timestamp(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_job := NEW."jobId";
    target_date := NEW."date";
  ELSE
    target_job := OLD."jobId";
    target_date := OLD."date";
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'lastCorrectedByUserId') = (to_jsonb(OLD) - 'lastCorrectedByUserId')
     AND (NEW."lastCorrectedByUserId" IS NULL OR NEW."lastCorrectedByUserId" = OLD."lastCorrectedByUserId") THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TimesheetSignoff" s
    WHERE s."jobId" = target_job AND s."date" = target_date AND s."reopenedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'TimeEntry day is signed and locked (job=%, date=%): reopen the sign-off before changing its hours.', target_job, to_char(target_date, 'YYYY-MM-DD');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "TimeEntry_day_lock" ON "TimeEntry";
CREATE TRIGGER "TimeEntry_day_lock" BEFORE INSERT OR UPDATE OR DELETE ON "TimeEntry" FOR EACH ROW EXECUTE FUNCTION prova_time_entry_day_lock();
