-- Which model caller an AskUsage row came from.
--
-- Additive and defaulted on purpose: every row that exists today IS an Ask
-- row, so the default backfills them correctly without a data migration, and
-- `askAllowance` keeps counting exactly what it counted before.
--
-- Three of this app's four model callers (WIP narrative, compliance document
-- extraction, draft estimate lines — all in packages/integrations/src/anthropic.ts)
-- reported no usage at all until 2026-09-14. This column is what lets one
-- table hold all four without the Ask row limits suddenly counting a
-- compliance upload as a question somebody asked.
ALTER TABLE "AskUsage" ADD COLUMN "feature" TEXT NOT NULL DEFAULT 'ask';

-- The read this enables: "what has this company spent on <feature> lately".
-- Without it, splitting the usage page by caller is a table scan over a table
-- that grows by one row per model call.
CREATE INDEX "AskUsage_companyId_feature_createdAt_idx"
  ON "AskUsage" ("companyId", "feature", "createdAt");
