-- What a payment platform deducted in transit, and who took it.
--
-- ADDITIVE ONLY. Two nullable columns. No DROP, nothing made NOT NULL, no
-- default, no backfill, no existing row read or rewritten. Every Payment
-- that exists today keeps exactly the value it has.
--
-- `Payment.amount` is NOT touched and does not change meaning: it stays
-- what was APPLIED to the invoice, because lib/actions/billing.ts derives
-- the balance from it and lib/actions/quickbooks.ts sends it as QuickBooks
-- TotalAmt. Cash actually received is derived as amount - feeAmount.
--
-- Announced in #prova-build before this was pushed, per the working
-- agreement. Ships deliberately unwired: no action writes these columns
-- and no read path selects them yet.
ALTER TABLE "Payment" ADD COLUMN "feeAmount" DECIMAL(12,2);
ALTER TABLE "Payment" ADD COLUMN "feeSource" TEXT;
