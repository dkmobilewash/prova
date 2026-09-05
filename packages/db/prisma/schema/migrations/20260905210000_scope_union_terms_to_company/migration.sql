-- Scope NEGOTIATED UNION TERMS to the company that negotiated them.
--
-- issue #136. UnionLocal and CraftClassification stay GLOBAL on purpose:
-- two contractors under one hall are under the SAME REAL LOCAL, and
-- ApprenticeshipEnrollment points at it, so duplicating that identity per
-- company would be the wrong fix. What was wrong is that the NEGOTIATED
-- TERMS -- base wage, pension, vacation, H&W, training, and the apprentice
-- ratio that drives a compliance judgement -- hung off that shared
-- identity. Typing a public local number into /union-compliance read
-- another company's money, and its delete paths could take their rows.
--
-- ADDITIVE. Nothing is dropped, nothing is made NOT NULL, no row is
-- deleted. The one non-additive statement is the exclusion constraint
-- swap at the bottom, which is argued for there.

-- ---------------------------------------------------------------- columns
ALTER TABLE "FringeRateSchedule"  ADD COLUMN "companyId" TEXT;
ALTER TABLE "ApprenticeRatioRule" ADD COLUMN "companyId" TEXT;

CREATE INDEX "FringeRateSchedule_companyId_idx"  ON "FringeRateSchedule"("companyId");
CREATE INDEX "ApprenticeRatioRule_companyId_idx" ON "ApprenticeRatioRule"("companyId");

ALTER TABLE "FringeRateSchedule"
  ADD CONSTRAINT "FringeRateSchedule_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApprenticeRatioRule"
  ADD CONSTRAINT "ApprenticeRatioRule_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------- backfill
--
-- ONLY the rows whose company is UNAMBIGUOUS.
--
-- A FringeRateSchedule reaches a company in two hops (schedule ->
-- CraftClassification -> UnionLocal -> CompanyUnionAgreement) and an
-- ApprenticeRatioRule in one. Where a local has agreements with more than
-- one company there is NO single correct companyId for its shared rows,
-- and the production query that would say how many such rows exist cannot
-- be run from here. So this does not guess.
--
-- `HAVING COUNT(DISTINCT "companyId") = 1` is the whole safety property:
-- a local with two or more companies under it matches nothing, and a local
-- with no agreement at all matches nothing either. Those rows keep
-- companyId NULL, every read is scoped `companyId = <viewer>`, and a NULL
-- row is therefore invisible to EVERYONE rather than visible to the wrong
-- person. The failure mode is "re-enter your own rates" -- honest, visible
-- and safe -- never "you are silently reading someone else's money".
--
-- MIN() is not a tie-break; inside the HAVING there is exactly one
-- distinct value, so MIN() simply reads it.

-- Written as an inline subquery in each statement rather than a shared
-- temporary view: Prisma splits a migration file into statements itself,
-- and a definition that has to survive from one statement to the next is a
-- dependency on how it splits. Each statement below stands alone.

UPDATE "ApprenticeRatioRule" AS r
   SET "companyId" = s."companyId"
  FROM (
        SELECT "unionLocalId", MIN("companyId") AS "companyId"
          FROM "CompanyUnionAgreement"
         GROUP BY "unionLocalId"
        HAVING COUNT(DISTINCT "companyId") = 1
       ) AS s
 WHERE r."unionLocalId" = s."unionLocalId";

UPDATE "FringeRateSchedule" AS f
   SET "companyId" = s."companyId"
  FROM "CraftClassification" AS c
  JOIN (
        SELECT "unionLocalId", MIN("companyId") AS "companyId"
          FROM "CompanyUnionAgreement"
         GROUP BY "unionLocalId"
        HAVING COUNT(DISTINCT "companyId") = 1
       ) AS s ON s."unionLocalId" = c."unionLocalId"
 WHERE f."craftClassificationId" = c."id";

-- ------------------------------------------- the non-overlap constraint
--
-- 20260824171704 added, hand-written because Prisma's DSL cannot express
-- it, an exclusion constraint stopping two rate schedules for the same
-- CraftClassification from covering the same date -- so that a historical
-- payroll can never depend on which row was read.
--
-- That constraint is keyed on the classification ALONE, and the
-- classification is GLOBAL. Once rates are company-scoped it stops being a
-- correctness guarantee and becomes a cross-tenant blocker: contractor B,
-- told to re-enter their own rates for a craft under a shared hall, would
-- be REFUSED because contractor A already has a row covering those dates
-- -- refused on the strength of a row B is not allowed to see, with a
-- message about it. That breaks the remedy this migration exists to
-- provide, so the constraint has to be re-keyed.
--
-- This is the only statement here that is not purely additive. It drops no
-- data, no column and no table; it is a constraint definition swap and it
-- is exactly reversible. WITHIN a company the new constraint is IDENTICAL
-- to the old one -- the guarantee that mattered is untouched. Across
-- companies it now permits what it should always have permitted.
--
-- COALESCE(..., '') rather than a bare "companyId": an exclusion
-- constraint's = operator yields NULL for a NULL column, so NULL rows
-- would conflict with nothing at all and the orphans left by the backfill
-- above would silently lose the overlap guarantee they have today. The
-- COALESCE lumps every orphan under one sentinel key, which reproduces the
-- OLD behaviour for exactly the rows that still have the old shape.
--
-- The new constraint is strictly weaker than the old one, so it validates
-- against any data the old one already accepted. It cannot fail on
-- production rows.

ALTER TABLE "FringeRateSchedule" DROP CONSTRAINT "FringeRateSchedule_no_overlapping_rates";

ALTER TABLE "FringeRateSchedule" ADD CONSTRAINT "FringeRateSchedule_no_overlapping_rates"
EXCLUDE USING gist (
  COALESCE("companyId", '') WITH =,
  "craftClassificationId" WITH =,
  tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp)) WITH &&
);
