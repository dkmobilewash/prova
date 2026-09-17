-- Overhead and profit: the explicit line between the subtotal and the total
-- on a change-order request, and the company default it is copied from.
--
-- ADDITIVE ONLY. Two NULLABLE columns on two existing tables. No table,
-- column, constraint or index is altered or dropped, and no row is rewritten.
--
-- NO BACKFILL, DELIBERATELY. Nothing in this database records what any
-- company's overhead-and-profit rate is, so there is nothing to derive one
-- from. A DEFAULT 0 here would turn "nobody has said" into the claim "this
-- company adds no overhead or profit", which is the one thing the reading
-- code must never print: a wrong markup gets bid, a missing one gets asked
-- about. Every read site renders NULL as "Not set" and leaves it out of the
-- total rather than adding zero -- see apps/web/lib/overhead-and-profit.ts.
--
-- DECIMAL(5,2) matches the other rates in this schema ("Job"."retainagePercent",
-- "Contact"."defaultRetainagePercent"): 15.00 means 15%, three integer digits
-- so 100.00 fits.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "overheadAndProfitPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN "overheadAndProfitPercent" DECIMAL(5,2);
