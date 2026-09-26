-- Equipment becomes a cost category of its own.
--
-- ADDITIVE ONLY, deliberately: an enum value and two nullable columns. There
-- is no backfill and there CANNOT be one. Plant and rental has been booked
-- under OTHER since the enum was written, and nothing in the data records
-- which OTHER rows were equipment — a guess would invent cost attribution on
-- real jobs. So equipment is complete from here forward and understated for
-- everything already entered, and the estimate screen says so rather than
-- letting the number imply otherwise.
--
-- BEFORE 'OTHER' rather than a bare ADD VALUE, which appends. Postgres sorts
-- an enum column by the value's position in the type, so appending would put
-- EQUIPMENT after the fallback in every ORDER BY while jobs.prisma declares it
-- before — a disagreement between the schema file and the database that
-- nothing would report. This pins the two to the same order.
--
-- Safe in Prisma's per-migration transaction on PG 12+: a value added in a
-- transaction may not be USED in that transaction, and nothing here uses it.
ALTER TYPE "CostCategory" ADD VALUE 'EQUIPMENT' BEFORE 'OTHER';

-- Its markup rate, on the per-job recap and on the company defaults. Nullable
-- with no default, like the four beside it: a company that has never set an
-- equipment markup has not set one, and defaulting it to the OTHER rate would
-- put a number on a bid nobody chose.
ALTER TABLE "JobBidRecap" ADD COLUMN "equipmentMarkupPercent" DECIMAL(5,2);

ALTER TABLE "CompanyBidDefaults" ADD COLUMN "equipmentMarkupPercent" DECIMAL(5,2);
