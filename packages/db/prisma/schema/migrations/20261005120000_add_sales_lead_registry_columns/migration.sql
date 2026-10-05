-- THE PUBLIC-REGISTER COLUMNS ON SalesLead.
--
-- Purely ADDITIVE: five nullable columns and one index, no drop, no rename, no
-- default, no backfill. Nothing reads these columns until the deploy that adds
-- the code, and the deploy that adds the code reads them as NULL on every
-- existing row — which is their defined meaning ("the document did not say").
-- So there is no expand-then-contract window here: an old build cannot notice
-- a column it never selects.
--
-- WHY THERE IS NO BACKFILL, although one is derivable. Every imported lead's
-- licence number is sitting in a LICENCE signal's claim ("Listed with licence
-- C-9 884201 (line 14 of the listing)"), so a regex over SalesLeadSignal.claim
-- would fill most of these in. It is deliberately not done: a claim is prose
-- written for a person, parsing it back out would make the number depend on the
-- wording of a sentence, and a join key assembled by a migration's regex is a
-- confident wrong answer waiting on the one claim that is phrased differently.
-- Re-importing the listing fills the columns from the document, which is where
-- they come from.
--
-- The index is NOT unique. Two leads carrying one licence number are a
-- duplicate worth noticing, and a unique index would make noticing it a
-- Postgres error that production REDACTS, in the middle of an import of up to
-- sixty rows.
ALTER TABLE "SalesLead" ADD COLUMN     "city" TEXT,
ADD COLUMN     "licenceNumber" TEXT,
ADD COLUMN     "listedByGc" TEXT,
ADD COLUMN     "listedOnProject" TEXT,
ADD COLUMN     "registrationNumber" TEXT;

-- CreateIndex
CREATE INDEX "SalesLead_companyId_licenceNumber_idx" ON "SalesLead"("companyId", "licenceNumber");
