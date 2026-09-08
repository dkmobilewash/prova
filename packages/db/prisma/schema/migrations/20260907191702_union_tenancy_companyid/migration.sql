-- #136 finding 1: UnionLocal, CraftClassification, FringeRateSchedule and
-- ApprenticeRatioRule carried no companyId. The only access check was
-- holding a CompanyUnionAgreement with the local, and that agreement was
-- self-asserted -- createUnionLocalAndAgreement adopted any EXISTING local
-- by (parentInternational, localNumber), both public information. Anyone
-- who signed up and typed a real local's name/number got an agreement with
-- it for free.
--
-- A read-only audit against production (scripts/union-tenancy-audit.mjs,
-- run 2026-09-07) answered the two questions this backfill depends on:
-- zero locals were claimed by more than one company (the backfill below is
-- single-valued, not a guess among several), and zero locals had no
-- agreement row at all (NOT NULL is safe -- nothing is left behind null).
-- Every UnionLocal, CompanyUnionAgreement pair in this app is created in
-- the SAME transaction (createUnionLocalAndAgreement), so an agreement-less
-- local should not exist anywhere this schema has been the only way in;
-- the backfill still picks deterministically (earliest agreement) rather
-- than assuming exactly one, in case a seed or test fixture ever creates
-- one directly.

-- Step 1: add each column NULLABLE first. A required column with no
-- default fails outright on a table that already has rows (this migration
-- hit exactly that error against a seeded dev database before it was
-- rewritten this way) -- the backfill below has to run before NOT NULL can
-- be asserted.
ALTER TABLE "UnionLocal" ADD COLUMN "companyId" TEXT;
ALTER TABLE "CraftClassification" ADD COLUMN "companyId" TEXT;
ALTER TABLE "FringeRateSchedule" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ApprenticeRatioRule" ADD COLUMN "companyId" TEXT;

-- Step 2: backfill, in dependency order. CraftClassification and
-- ApprenticeRatioRule read UnionLocal.companyId, and FringeRateSchedule
-- reads CraftClassification.companyId, so UnionLocal has to be filled
-- first and CraftClassification before FringeRateSchedule. unionLocalId
-- and craftClassificationId are both required, RESTRICT-on-delete foreign
-- keys already, so every row here is guaranteed to find a parent row to
-- read from -- the only column that can end up genuinely unmatched is
-- UnionLocal.companyId itself, and the audit above says that does not
-- happen in production today.
UPDATE "UnionLocal" AS u
SET "companyId" = (
  SELECT a."companyId"
  FROM "CompanyUnionAgreement" a
  WHERE a."unionLocalId" = u.id
  ORDER BY a."effectiveFrom" ASC
  LIMIT 1
);

UPDATE "CraftClassification" AS c
SET "companyId" = u."companyId"
FROM "UnionLocal" u
WHERE u.id = c."unionLocalId";

UPDATE "FringeRateSchedule" AS f
SET "companyId" = cc."companyId"
FROM "CraftClassification" cc
WHERE cc.id = f."craftClassificationId";

UPDATE "ApprenticeRatioRule" AS r
SET "companyId" = u."companyId"
FROM "UnionLocal" u
WHERE u.id = r."unionLocalId";

-- Step 3: now that every row is filled, make it required. This is the line
-- that would fail loudly -- rather than silently -- if any environment
-- turns out to hold a local the audit's production query never saw: a
-- crash here names the table and blocks the deploy, which is the outcome
-- CLAUDE.md's own migration-race entries call for over a guess.
ALTER TABLE "UnionLocal" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CraftClassification" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "FringeRateSchedule" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ApprenticeRatioRule" ALTER COLUMN "companyId" SET NOT NULL;

-- Step 4: UnionLocal's identity used to be global -- (parentInternational,
-- localNumber) alone. Two companies signatory to the same real local now
-- each hold their OWN row, so the identity has to include which company's
-- row it is; without dropping the old constraint first, two companies
-- recording the same real local would collide on it.
DROP INDEX "UnionLocal_parentInternational_localNumber_key";
CREATE UNIQUE INDEX "UnionLocal_companyId_parentInternational_localNumber_key" ON "UnionLocal"("companyId", "parentInternational", "localNumber");

-- Step 5: indexes, matching the pattern every other companyId column in
-- this schema already uses.
CREATE INDEX "UnionLocal_companyId_idx" ON "UnionLocal"("companyId");
CREATE INDEX "CraftClassification_companyId_idx" ON "CraftClassification"("companyId");
CREATE INDEX "FringeRateSchedule_companyId_idx" ON "FringeRateSchedule"("companyId");
CREATE INDEX "ApprenticeRatioRule_companyId_idx" ON "ApprenticeRatioRule"("companyId");

-- Step 6: foreign keys. RESTRICT rather than CASCADE, matching every other
-- companyId relation on Company in this schema (e.g. CompanyUnionAgreement
-- above) -- deleting a Company is not a path this app exposes, and RESTRICT
-- is the safer default if that ever changes.
ALTER TABLE "UnionLocal" ADD CONSTRAINT "UnionLocal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CraftClassification" ADD CONSTRAINT "CraftClassification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FringeRateSchedule" ADD CONSTRAINT "FringeRateSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprenticeRatioRule" ADD CONSTRAINT "ApprenticeRatioRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
