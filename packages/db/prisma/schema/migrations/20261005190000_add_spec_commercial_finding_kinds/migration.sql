-- The three Division 00/01 cost drivers the spec reader could not report.
--
-- PURELY ADDITIVE: three new values on an existing enum. Nothing is dropped,
-- nothing is renamed, no row changes, and no backfill is possible or wanted —
-- a reading taken before today came from a reader that could not have produced
-- these kinds, which is what `SPEC_SECTION_PROMPT_VERSION` ("spec-section.2")
-- records on each row.
--
-- SAFE IN THE OLD BUILD'S HANDS, which is the question CLAUDE.md's
-- expand/contract rule actually asks: `migrate.yml` applies this on merge while
-- Vercel is still building the commit that knows these values, so for a couple
-- of minutes the LIVE build is the previous one. Adding an enum value is
-- invisible to it — `BidSpecReading.findings` is `Json` and no column is typed
-- as this enum at all, so the old build neither reads nor writes it. A DROP here
-- would have been the opposite, and would have needed two PRs.
--
-- THREE VALUES IN ONE MIGRATION is fine on this database and Prisma's warning
-- is about PostgreSQL 11 and earlier. Production is Neon (16) and CI is
-- `postgres:16`. Postgres 12+ allows ADD VALUE inside a transaction provided the
-- new value is not USED in the same transaction, and nothing here uses it.
--
-- WHY AN UNREFERENCED ENUM IS WORTH MIGRATING AT ALL. Nothing enforces it: the
-- real gate is `isSpecFindingKind` over one array in
-- `packages/integrations/src/specs.ts`, from which the TS type and the model's
-- tool schema are both derived. This type is DOCUMENTATION a reviewer reads to
-- learn what a finding can be, so a stale one teaches the wrong vocabulary
-- silently and forever. `apps/web/lib/specs/specFindingKindCensus.test.ts` is
-- what now makes the two agree, and it fails the build when they do not — which
-- is the job this enum did not have until today.

-- AlterEnum
ALTER TYPE "BidSpecFindingKind" ADD VALUE 'LIQUIDATED_DAMAGES';
ALTER TYPE "BidSpecFindingKind" ADD VALUE 'WORKING_HOURS';
ALTER TYPE "BidSpecFindingKind" ADD VALUE 'WAGE_REQUIREMENT';
