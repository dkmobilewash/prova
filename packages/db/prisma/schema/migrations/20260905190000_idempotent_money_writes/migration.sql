-- Idempotent money and evidence writes (issue #102).
--
-- ADDITIVE ONLY: two new columns with defaults, one new table, one unique
-- index. Nothing is dropped, nothing is renamed, no column changes type.
--
-- The one way this migration can FAIL is the Backcharge unique index, if
-- the same GC reference is already logged twice on one job. That is exactly
-- the duplicate #102 is about, so failing is the correct outcome — but a
-- bare "duplicate key value violates unique constraint" names neither the
-- job nor the reference, so the check below raises first and says which
-- rows to fix. Delete the duplicate backcharge in the app and re-run.

DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(format('job %s / GC reference %L (%s rows)', "jobId", "gcReference", n), '; ')
    INTO offenders
    FROM (
      SELECT "jobId", "gcReference", count(*) AS n
        FROM "Backcharge"
       WHERE "gcReference" IS NOT NULL
       GROUP BY "jobId", "gcReference"
      HAVING count(*) > 1
    ) dupes;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add the Backcharge natural-key constraint: the same GC reference is already logged more than once on a job. Delete the duplicate rows, then re-run. Offending groups: %',
      offenders;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Backcharge_jobId_gcReference_key" ON "Backcharge"("jobId", "gcReference");

-- AddForeignKey
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the counter from the invoices that already exist.
--
-- This is the ONE place `max(number)` is legitimate: it is the handover
-- from the old scheme to the new one, run once, and after it the counter
-- never reads Invoice again. Without it, `issueInvoiceNumber`'s upsert
-- would create a counter at 1 for a job that already has invoices 1..7 and
-- the insert would die on Invoice_jobId_number_key.
--
-- Jobs with no invoices get no row here on purpose — the upsert's create
-- branch starts them at 1, which is correct and is also the path every new
-- job takes.
INSERT INTO "InvoiceCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("number"), CURRENT_TIMESTAMP
  FROM "Invoice"
 GROUP BY "jobId";
