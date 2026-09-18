-- ExperienceModRate: the EMR as the rating bureau issued it, per company per
-- policy year.
--
-- ADDITIVE ONLY. One new table, its unique index, its two foreign keys and
-- one CHECK. Nothing existing is altered, nothing is dropped, nothing becomes
-- NOT NULL, no row is read or rewritten. Safe against a database with live
-- companies.
--
-- NO BACKFILL, DELIBERATELY. There is nothing in this database an EMR could
-- honestly be derived from. The OSHA log is what a bureau calculates one FROM,
-- alongside payroll and loss data the carrier reports and this app never
-- sees, so any backfilled figure would be a number no insurer has quoted.
-- An empty table says "not recorded", which is the truth.
--
-- Hand-written rather than generated, and every statement on ONE line,
-- because scratch-cleanup-order.test.ts counts "FOREIGN KEY" occurrences
-- against what its pattern parses — a wrapped constraint is the exact shape
-- that silently shrank that set once before. The CREATE TABLE is the only
-- multi-line statement and carries no foreign key. Checked against
-- `prisma migrate diff --from-schema-datamodel <main> --to-schema-datamodel
-- <this branch>`, which emits the same table, index and constraints.

-- CreateTable
CREATE TABLE "ExperienceModRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "rate" DECIMAL(5,3) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperienceModRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One rate per company per policy-year start. A bureau revision of a rating
-- is an edit of that row, not a second row: two rows on one date would leave
-- "which rate is current" with no honest answer.
CREATE UNIQUE INDEX "ExperienceModRate_companyId_effectiveDate_key" ON "ExperienceModRate"("companyId", "effectiveDate");

-- AddForeignKey
-- RESTRICT, like every other company-scoped table: a company is never
-- deleted out from under its records.
ALTER TABLE "ExperienceModRate" ADD CONSTRAINT "ExperienceModRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL: who typed it in is optional; the rate stays when they leave.
ALTER TABLE "ExperienceModRate" ADD CONSTRAINT "ExperienceModRate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A mod is a positive multiplier. The action refuses zero and negatives in a
-- sentence; this is the floor under it for anything that writes around the
-- action. No NOT VALID step is needed — the table is new and empty.
ALTER TABLE "ExperienceModRate" ADD CONSTRAINT "ExperienceModRate_rate_positive" CHECK ("rate" > 0);
