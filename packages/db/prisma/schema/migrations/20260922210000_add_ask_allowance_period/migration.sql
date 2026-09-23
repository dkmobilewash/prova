-- The paid monthly AI allowance: one claim ledger row per company per
-- calendar month. See packages/db/prisma/schema/ask-allowance.prisma for
-- why this is a claim ledger and not a count of AskUsage rows.
--
-- ADDITIVE ONLY. One new table, its unique index and its foreign key.
-- Nothing is dropped, nothing is altered, and no existing row is touched,
-- so the deploy that starts reading it can land before or after this
-- migration without a window in which the running build reads a column
-- that is not there (CLAUDE.md, "a drop and the deploy that stops reading
-- the column do not land together").
--
-- NO BACKFILL, and that is the right answer here rather than an omission.
-- InvoiceCounter had to backfill from MAX(number) because a counter
-- starting at zero would have reissued numbers a GC had already been sent.
-- Nothing is reissued here: an absent period row means "this company has
-- claimed nothing this month", which is exactly true on the day this ships
-- — there was no allowance to have spent.

-- CreateTable
CREATE TABLE "AskAllowancePeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "questionsUsed" INTEGER NOT NULL DEFAULT 0,
    "pagesUsed" INTEGER NOT NULL DEFAULT 0,
    "failedQuestions" INTEGER NOT NULL DEFAULT 0,
    "failedPages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskAllowancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AskAllowancePeriod_companyId_periodStart_key" ON "AskAllowancePeriod"("companyId", "periodStart");

-- AddForeignKey
ALTER TABLE "AskAllowancePeriod" ADD CONSTRAINT "AskAllowancePeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
