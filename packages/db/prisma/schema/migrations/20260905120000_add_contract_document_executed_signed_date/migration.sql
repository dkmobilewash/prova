-- Additive only: one nullable column. No DROP, nothing made NOT NULL,
-- no default, no backfill.
--
-- The date the GC signed an already-executed subcontract, ENTERED by
-- whoever recorded it. Null on every existing row and on every ordinary
-- document upload — there is no backfill source, and guessing a date for a
-- document nobody asserted anything about would invent evidence.

-- AlterTable
ALTER TABLE "ContractDocument" ADD COLUMN "executedSignedDate" TIMESTAMP(3);
