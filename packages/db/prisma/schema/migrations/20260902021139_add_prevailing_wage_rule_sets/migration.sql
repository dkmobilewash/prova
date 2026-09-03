-- CreateEnum
CREATE TYPE "PrevailingWageAuthority" AS ENUM ('FEDERAL', 'STATE', 'COUNTY', 'CITY');

-- CreateEnum
CREATE TYPE "PrevailingWageFilingFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "PrevailingWageDetermination" ADD COLUMN     "ruleSetId" TEXT;

-- CreateTable
CREATE TABLE "PrevailingWageRuleSet" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "authority" "PrevailingWageAuthority" NOT NULL,
    "dailyOvertimeAfterHours" DECIMAL(4,2),
    "dailyDoubleTimeAfterHours" DECIMAL(4,2),
    "weeklyOvertimeAfterHours" DECIMAL(5,2),
    "seventhDayOvertimeAfterHours" DECIMAL(4,2),
    "seventhDayDoubleTimeAfterHours" DECIMAL(4,2),
    "filingFrequency" "PrevailingWageFilingFrequency" NOT NULL DEFAULT 'WEEKLY',
    "filingDueDays" INTEGER,
    "formName" TEXT,
    "portalUrl" TEXT,
    "sourceUrl" TEXT,
    "note" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrevailingWageRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrevailingWageRuleSet_companyId_idx" ON "PrevailingWageRuleSet"("companyId");

-- AddForeignKey
ALTER TABLE "PrevailingWageDetermination" ADD CONSTRAINT "PrevailingWageDetermination_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PrevailingWageRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevailingWageRuleSet" ADD CONSTRAINT "PrevailingWageRuleSet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Two rule sets for the same jurisdiction cannot overlap in time.
--
-- Hand-written raw SQL, exactly like FringeRateSchedule's constraint in
-- 20260824171704_add_union_affiliation, and for the same reason: Prisma's
-- DSL has no way to express a Postgres exclusion constraint, so this is
-- written here rather than generated from the model.
--
-- It matters more here than tidiness. lib/prevailing-wage.ts picks THE
-- rule set in force on a date. If two overlapped, "the rules that applied
-- that week" would depend on row order, and a timesheet review would give
-- different answers on different days with nothing to explain it.
--
-- Scoped by company as well as jurisdiction: two companies both recording
-- "California" is normal and must not collide.
--
-- Prisma Client does not know this constraint exists, so a violation
-- arrives as a raw Postgres error (P2010) rather than a typed one — the
-- create/edit action catches and translates it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "PrevailingWageRuleSet" ADD CONSTRAINT "PrevailingWageRuleSet_no_overlapping_rules"
EXCLUDE USING gist (
  "companyId" WITH =,
  "jurisdiction" WITH =,
  tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp)) WITH &&
);
