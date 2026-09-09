-- InvoiceCounter: invoice numbers stop being max(number) + 1.
--
-- The table is ordinary. The BACKFILL at the bottom is the part that
-- matters: without it every job that already has invoices would start at
-- lastNumber 0, issue 1, and collide with its own history on
-- @@unique([jobId, number]) the first time anyone billed.

CREATE TABLE "InvoiceCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("jobId")
);

ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every job that has ever been invoiced starts from the highest number it
-- actually issued, so the next one is genuinely next. A job with no
-- invoices gets no row and is created at 1 by the first upsert.
INSERT INTO "InvoiceCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("number"), CURRENT_TIMESTAMP
FROM "Invoice"
GROUP BY "jobId";
