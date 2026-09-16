-- Issue #289. Additive: one new table plus its foreign key, and a backfill.
-- No existing table, column or constraint is altered or dropped.
--
-- EstimateVersion.versionNumber stops being MAX(versionNumber) + 1 read
-- outside a transaction. See the model comment in estimating.prisma for
-- the full reasoning; the short version is that two people saving a
-- checkpoint on the same job at once both read the same max and the second
-- lost their save to a unique-constraint violation that production
-- redacts. Measured at 49 of 50 rounds with two concurrent saves.
--
-- Same shape as InvoiceCounter (20260909180000) and
-- ContractDocumentVersionCounter (20260909194000).
CREATE TABLE "EstimateVersionCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateVersionCounter_pkey" PRIMARY KEY ("jobId")
);

ALTER TABLE "EstimateVersionCounter" ADD CONSTRAINT "EstimateVersionCounter_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every job that already has a saved estimate version starts from the
-- highest version it actually has. Without this every such job would start
-- at lastNumber 0, issue 1, and collide with its own history on
-- @@unique([jobId, versionNumber]) the first time anyone saved a version --
-- the identical backfill both counters above carry, and for the identical
-- reason.
--
-- Jobs with no saved versions get no row: the counter is created on first
-- use by the issuer's upsert, exactly as the other two are.
INSERT INTO "EstimateVersionCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("versionNumber"), CURRENT_TIMESTAMP
FROM "EstimateVersion"
GROUP BY "jobId";
