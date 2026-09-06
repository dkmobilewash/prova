-- Version numbers for ContractDocument, issued by a row that only increments.
--
-- Purely additive: one new table, no change to ContractDocument itself and
-- no backfill of existing rows. Existing documents keep the version numbers
-- they were given.
--
-- The counter is SEEDED from the highest version already on each job, so the
-- first upload after this migration issues max+1 exactly as before and never
-- collides with a document that already exists. From then on the row only
-- increments, so a deleted version's number is never reissued.

-- CreateTable
CREATE TABLE "ContractDocumentCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDocumentCounter_pkey" PRIMARY KEY ("jobId")
);

-- AddForeignKey
ALTER TABLE "ContractDocumentCounter" ADD CONSTRAINT "ContractDocumentCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed from what already exists, so no job's next upload reuses a live number.
INSERT INTO "ContractDocumentCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("versionNumber"), NOW()
FROM "ContractDocument"
GROUP BY "jobId";
