-- Two additive, nullable columns. No backfill, and nothing below rewrites an
-- existing row or changes what one means.
--
-- `BidQuote.validUntil` — how long the sub said their price holds. Null for
-- every existing row, which is correct rather than unknown: none of them was
-- ever asked, so none of them carries that statement. Deliberately NOT
-- backfilled from `quotedOn` plus a window; a staleness heuristic is ours and
-- this column is theirs, and writing our guess into their field is how the two
-- stop being distinguishable.
--
-- `CompanyBidDefaults.defaultWastePercent` — the company's waste figure. Null
-- means nobody has decided, and the code falls back to DEFAULT_WASTE_PERCENT
-- (10), which is the number the takeoff form already prefilled. So no existing
-- estimate and no existing wall type changes by a cent. Not given a column
-- DEFAULT of 10 on purpose: "has not decided" and "chose 10" are different
-- facts, and only one of them should survive us later changing our mind about
-- the sensible default.

-- AlterTable
ALTER TABLE "BidQuote" ADD COLUMN     "validUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CompanyBidDefaults" ADD COLUMN     "defaultWastePercent" DECIMAL(5,2);
