-- AlterTable: a change-order proposal carries the cost type its cost belongs
-- to, so it can be priced at the job's bid-recap rate for that type.
-- Additive and nullable; existing proposals stay uncategorised and are
-- marked up at nothing, as an uncategorised line is on the bid.
ALTER TABLE "ChangeOrderProposal" ADD COLUMN "costCategory" "CostCategory";
