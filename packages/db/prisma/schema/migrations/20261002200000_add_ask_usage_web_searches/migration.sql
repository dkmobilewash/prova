-- Step 2 of the AI plan needs a row's cost to be computable, and it was not:
-- web search bills PER SEARCH on top of tokens, `AskUsageTotals.webSearches`
-- has carried the count since lead search shipped, and `recordAskUsage` never
-- wrote it to the row. `lead-search` and `bid-research` are the two features
-- that use it, which is exactly why their cost could not be worked out.
--
-- ADDITIVE, WITH A DEFAULT, so it applies to a live table without a rewrite
-- and without a backfill. Existing rows read 0, which is right for the seven
-- features that never search and a FLOOR for the two that do — the API told us
-- the real number once and nobody wrote it down, so it is not recoverable.
-- `lib/ask/cost.ts` knows this migration's date and says so rather than
-- presenting a historical total as complete.

-- AlterTable
ALTER TABLE "AskUsage" ADD COLUMN     "webSearches" INTEGER NOT NULL DEFAULT 0;
