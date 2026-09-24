-- EmployerBurdenRate: the employer's cost of an hour BEYOND wage and CBA
-- fringes -- FICA, FUTA/SUTA, workers' comp -- as a percentage of the base
-- wage, per company, from a date.
--
-- ADDITIVE ONLY. One new table, its unique index, its two foreign keys and
-- one CHECK. Nothing existing is altered, nothing is dropped, nothing becomes
-- NOT NULL, no column is made required on existing rows, no row is read or
-- rewritten. Safe against a database with live companies.
--
-- NO BACKFILL, AND NO DEFAULT, DELIBERATELY -- THIS IS THE POINT OF THE
-- MIGRATION RATHER THAN AN OMISSION FROM IT. An empty table means "no
-- employer burden recorded", and every job-cost figure then comes out exactly
-- as it did before this table existed: the same wage-and-fringes arithmetic,
-- to the cent. Seeding a "typical" 7.65% or 20% here would silently move
-- `actualCostToDate`, percent complete, earned revenue and the WIP schedule
-- on every existing job in one merge -- numbers people have already quoted to
-- GCs -- which would be a far worse defect than the understatement this table
-- exists to let an owner fix. Nothing in this database could honestly be
-- derived into one anyway: no per-employee year-to-date wages, no state
-- unemployment account, no workers' comp class-code rate sheet.
--
-- Hand-written rather than generated, and every ALTER TABLE on ONE line,
-- because scratch-cleanup-order.test.ts counts "FOREIGN KEY" occurrences
-- against what its pattern parses -- a wrapped constraint is the exact shape
-- that silently shrank that set once before (#224). The CREATE TABLE is the
-- only multi-line statement and carries no foreign key. Checked against
-- `prisma migrate diff --from-schema-datamodel <main's schema dir>
-- --to-schema-datamodel <this branch's schema dir>`, a schema-to-schema diff
-- that opens no database connection, which emits the same table, index and
-- both constraints.

-- CreateTable
CREATE TABLE "EmployerBurdenRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "percent" DECIMAL(6,3) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerBurdenRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One rate per company per start date. Re-running the calculation for the
-- same date is an edit of that row, not a second row: two rows on one date
-- would leave "which burden applies" with no honest answer.
CREATE UNIQUE INDEX "EmployerBurdenRate_companyId_effectiveDate_key" ON "EmployerBurdenRate"("companyId", "effectiveDate");

-- AddForeignKey
-- RESTRICT, like every other company-scoped table: a company is never
-- deleted out from under its records.
ALTER TABLE "EmployerBurdenRate" ADD CONSTRAINT "EmployerBurdenRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL: who typed it in is optional; the rate stays when they leave.
ALTER TABLE "EmployerBurdenRate" ADD CONSTRAINT "EmployerBurdenRate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A burden is a percentage of wages and cannot be negative. ZERO IS ALLOWED
-- and is not the same as no row at all: a row of 0 records that somebody
-- worked it out and it came to nothing, which is a different statement from
-- an empty table, and it is the statement a later reader needs. The action
-- refuses a negative and an implausibly large one in a sentence; this is the
-- floor under it for anything that writes around the action. No NOT VALID
-- step is needed -- the table is new and empty.
ALTER TABLE "EmployerBurdenRate" ADD CONSTRAINT "EmployerBurdenRate_percent_not_negative" CHECK ("percent" >= 0);
