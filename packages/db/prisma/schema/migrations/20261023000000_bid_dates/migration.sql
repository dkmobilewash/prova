-- Bid dates: a due TIME, a job-walk date and time, and an RFI cutoff date.
--
-- ADDITIVE ONLY: four nullable columns, no default, no index, no backfill.
-- Nothing the running build reads changes shape, so the gap between this
-- landing and the next deploy going live cannot break a request.
ALTER TABLE "BidInvitation" ADD COLUMN "dueMinute" INTEGER,
ADD COLUMN "walkDate" TIMESTAMP(3),
ADD COLUMN "walkMinute" INTEGER,
ADD COLUMN "rfiCutoffDate" TIMESTAMP(3);
