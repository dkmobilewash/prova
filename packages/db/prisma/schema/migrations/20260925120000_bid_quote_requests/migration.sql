-- A BidQuote row is now the whole conversation rather than just the answer: it
-- starts as a request (no amount, no quoted date) and becomes a quote when a
-- price arrives.
--
-- PURELY ADDITIVE. Three nullable columns, and two NOT NULLs relaxed. No
-- existing row changes and nothing is dropped — every quote already recorded
-- has an amount and a quotedOn and keeps both.
--
-- A SECOND MIGRATION RATHER THAN AN EDIT to 20260924200000_add_bid_quotes,
-- which creates this table two commits earlier on this same unmerged branch.
-- Editing an applied migration changes its checksum and fails the next deploy
-- against any database that already has it, and nothing on this machine can
-- reach a database to find out whether one does. Two directories is the cost
-- of not needing to know.

-- AlterTable
ALTER TABLE "BidQuote" ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "dueBy" TIMESTAMP(3),
ADD COLUMN     "requestedOn" TIMESTAMP(3),
ALTER COLUMN "amount" DROP NOT NULL,
ALTER COLUMN "quotedOn" DROP NOT NULL;
