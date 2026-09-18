-- Daily report structure (Gap 2): a site address with coordinates for
-- automatic weather, structured delays, and the day sign-off locking the
-- report and its delays along with the hours.
--
-- ADDITIVE. Five nullable columns on Job, one on DailyFieldReport, two on
-- TimesheetSignoff, a new DelayEvent table with three enums, and two
-- triggers. No existing row is read or rewritten. The triggers only refuse a
-- write on a day that has a live TimesheetSignoff, and until now a signed day
-- locked only its hours — every existing report stays exactly as editable as
-- it was unless its day is signed.

-- CreateEnum
CREATE TYPE "DelayCause" AS ENUM ('WEATHER', 'GC_SCHEDULE', 'OTHER_TRADE', 'MATERIAL', 'INSPECTION', 'DESIGN_RFI', 'SITE_ACCESS', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DelayResponsibleParty" AS ENUM ('GC', 'OWNER', 'OTHER_TRADE', 'SUPPLIER', 'OURSELVES', 'NOBODY');

-- CreateEnum
CREATE TYPE "NotificationMethod" AS ENUM ('PHONE', 'EMAIL', 'TEXT', 'IN_PERSON', 'MEETING', 'OTHER');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "siteAddress" TEXT,
ADD COLUMN     "siteGeocodedAt" TIMESTAMP(3),
ADD COLUMN     "siteLatitude" DOUBLE PRECISION,
ADD COLUMN     "siteLongitude" DOUBLE PRECISION,
ADD COLUMN     "siteTimeZone" TEXT;

-- AlterTable
ALTER TABLE "TimesheetSignoff" ADD COLUMN     "manpower" JSONB,
ADD COLUMN     "reportSnapshot" JSONB;

-- AlterTable
ALTER TABLE "DailyFieldReport" ADD COLUMN     "weatherAuto" JSONB;

-- CreateTable
CREATE TABLE "DelayEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "cause" "DelayCause" NOT NULL,
    "responsibleParty" "DelayResponsibleParty" NOT NULL,
    "responsibleName" TEXT,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "workersAffected" INTEGER,
    "hoursLost" DECIMAL(7,2),
    "description" TEXT NOT NULL,
    "gcNotifiedHow" "NotificationMethod",
    "gcNotifiedWho" TEXT,
    "gcNotifiedAt" TIMESTAMP(3),
    "changeOrderId" TEXT,
    "loggedByUserId" TEXT,
    "clientOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DelayEvent_companyId_idx" ON "DelayEvent"("companyId");

-- CreateIndex
CREATE INDEX "DelayEvent_jobId_date_idx" ON "DelayEvent"("jobId", "date");

-- CreateIndex
CREATE INDEX "DelayEvent_changeOrderId_idx" ON "DelayEvent"("changeOrderId");

-- CreateIndex
CREATE INDEX "DelayEvent_loggedByUserId_idx" ON "DelayEvent"("loggedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DelayEvent_companyId_clientOperationId_key" ON "DelayEvent"("companyId", "clientOperationId");

-- AddForeignKey
ALTER TABLE "DelayEvent" ADD CONSTRAINT "DelayEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelayEvent" ADD CONSTRAINT "DelayEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelayEvent" ADD CONSTRAINT "DelayEvent_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelayEvent" ADD CONSTRAINT "DelayEvent_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A signed day's report is locked with its hours: no report added, edited
-- or removed while the day has a live sign-off. One exception: `weatherAuto`
-- (and the `updatedAt` Prisma stamps with it) may change, because replacing
-- the forecast with the observed day is an outside fact arriving, not the
-- foreman's signed account changing.
CREATE OR REPLACE FUNCTION prova_daily_report_day_lock() RETURNS trigger AS $$
DECLARE
  target_job text;
  target_date timestamp(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_job := NEW."jobId";
    target_date := NEW."reportDate";
  ELSE
    target_job := OLD."jobId";
    target_date := OLD."reportDate";
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['weatherAuto', 'updatedAt']) = (to_jsonb(OLD) - ARRAY['weatherAuto', 'updatedAt']) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TimesheetSignoff" s
    WHERE s."jobId" = target_job AND s."date" = target_date AND s."reopenedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'DailyFieldReport day is signed and locked (job=%, date=%): reopen the sign-off before changing the report.', target_job, to_char(target_date, 'YYYY-MM-DD');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DailyFieldReport_day_lock" ON "DailyFieldReport";
CREATE TRIGGER "DailyFieldReport_day_lock" BEFORE INSERT OR UPDATE OR DELETE ON "DailyFieldReport" FOR EACH ROW EXECUTE FUNCTION prova_daily_report_day_lock();

-- The same lock on a day's delays. The exception here is `changeOrderId`
-- (and `updatedAt`): drafting a change order from a delay is what the office
-- does AFTER the day is signed, and ON DELETE SET NULL from a discarded
-- draft has to be able to clear it.
CREATE OR REPLACE FUNCTION prova_delay_event_day_lock() RETURNS trigger AS $$
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
     AND (to_jsonb(NEW) - ARRAY['changeOrderId', 'updatedAt']) = (to_jsonb(OLD) - ARRAY['changeOrderId', 'updatedAt']) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TimesheetSignoff" s
    WHERE s."jobId" = target_job AND s."date" = target_date AND s."reopenedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'DelayEvent day is signed and locked (job=%, date=%): reopen the sign-off before changing its delays.', target_job, to_char(target_date, 'YYYY-MM-DD');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DelayEvent_day_lock" ON "DelayEvent";
CREATE TRIGGER "DelayEvent_day_lock" BEFORE INSERT OR UPDATE OR DELETE ON "DelayEvent" FOR EACH ROW EXECUTE FUNCTION prova_delay_event_day_lock();
