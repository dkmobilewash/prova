-- Issue #280. DATA ONLY -- no table, column, constraint or index changes.
--
-- WHY EXISTING ROWS NEED THIS AND THE CODE FIX IS NOT ENOUGH.
-- ContractDocument had two writers with two numbering schemes:
-- uploadContractDocument issued from ContractDocumentVersionCounter, and
-- recordExecutedSubcontract used MAX(versionNumber) + 1 and never bumped
-- the counter. Every executed subcontract recorded since the counter
-- shipped therefore left that job's counter BEHIND its rows.
--
-- A job in that state is not merely mis-numbered, it is broken: the next
-- ordinary upload issues a number that already exists, violates
-- @@unique([jobId, versionNumber]), and -- because the bump and the insert
-- are one transaction -- rolls the bump back, so every retry fails the
-- same way for ever. Fixing the code stops NEW jobs entering that state
-- and does nothing for the ones already in it. This is what repairs them.
--
-- GREATEST, NOT MAX(versionNumber) OUTRIGHT, and that is the load-bearing
-- word. A counter is allowed to be AHEAD of the surviving rows -- that is
-- what it is for. Delete version 3 and the counter still says 3, so the
-- next upload is 4 and the retired number is never reissued. Assigning
-- MAX(versionNumber) unconditionally would drag such a counter backwards
-- and reissue a version label that a GC may already hold a document for,
-- which is the exact defect the counter exists to prevent. GREATEST moves
-- a counter forward when it is behind and leaves it alone when it is
-- ahead.
--
-- Jobs with contract documents but NO counter row get one, at the highest
-- version they actually have. That is the fresh-job case: the executed
-- subcontract was recorded first, so nothing ever created the row.
--
-- Idempotent, and a no-op on a database where no executed subcontract was
-- ever recorded. Jobs with no contract documents are untouched -- no
-- counter row is invented for them, exactly as the original backfill in
-- 20260909194000_add_gc_surface_token_controls did it.
INSERT INTO "ContractDocumentVersionCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("versionNumber"), CURRENT_TIMESTAMP
FROM "ContractDocument"
GROUP BY "jobId"
ON CONFLICT ("jobId") DO UPDATE
SET "lastNumber" = GREATEST(
      "ContractDocumentVersionCounter"."lastNumber",
      EXCLUDED."lastNumber"
    ),
    "updatedAt" = CURRENT_TIMESTAMP;
