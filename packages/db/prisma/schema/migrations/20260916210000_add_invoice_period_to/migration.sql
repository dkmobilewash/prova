-- Invoice.periodTo: the G702 PERIOD TO date, entered rather than stamped.
--
-- Nullable and NOT backfilled, on purpose. `issuedAt` is the moment of the
-- submit click, not the end of a billing period, so filling this column
-- from it would print a wrong PERIOD TO on a document a GC's accounting
-- department keys on. Rows that predate this column read as "Not recorded".

ALTER TABLE "Invoice" ADD COLUMN "periodTo" TIMESTAMP(3);
