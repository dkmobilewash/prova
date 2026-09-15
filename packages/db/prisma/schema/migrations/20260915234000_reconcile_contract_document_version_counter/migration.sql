-- Issue #279. Data-only: no table, column or constraint changes.
--
-- WHY THIS IS NEEDED AT ALL. 20260909194000 created
-- ContractDocumentVersionCounter and backfilled it from MAX(versionNumber)
-- per job, which was correct for every job that HAD a contract document at
-- that moment. But only one of the table's two writers was converted to use
-- it: recordExecutedSubcontract kept computing MAX(versionNumber) + 1 and
-- never touched the counter. So every job whose contract documents arrived
-- through that path since 9 Sep has a counter row that is missing, or stale
-- and lower than the rows it is supposed to be ahead of. The code fix stops
-- new divergence; it cannot repair what already diverged, and those jobs
-- stay primed to collide on @@unique([jobId, versionNumber]) the first time
-- anyone uploads an amendment.
--
-- GREATEST IS THE LOAD-BEARING WORD, and it is what makes this different
-- from the original backfill. A counter row may legitimately sit ABOVE the
-- surviving rows' maximum, because deleteContractDocument is a real action
-- and this counter only ever increments — that is the entire reason it
-- exists rather than being derived. Taking MAX(versionNumber) unconditionally
-- would LOWER such a counter and reissue a version number that a GC has
-- already been sent, which is the bug the counter was introduced to prevent.
-- So this only ever raises.
--
-- Safe to re-run: the second run raises nothing, because the first already
-- did. Idempotent by construction rather than by a guard.
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
