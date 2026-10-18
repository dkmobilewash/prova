-- CreateEnum
--
-- Whether a shop takes door and window openings off the board quantity. There
-- is no right answer — `takeoff.ts` says so where its 32 sq ft default is
-- declared, "shops differ, and some deduct nothing at all" — so it is a
-- question the company answers rather than a constant this app picks for them.
CREATE TYPE "OpeningDeduction" AS ENUM ('NONE', 'LARGE_ONLY', 'ALL');

-- AlterTable
--
-- NULLABLE WITH NO DEFAULT, deliberately: null means unanswered, and unanswered
-- resolves to the 32 sq ft threshold the app already uses. Every existing
-- company keeps the exact quantities it had, and nothing moves until somebody
-- answers the question.
ALTER TABLE "Company" ADD COLUMN "openingDeduction" "OpeningDeduction";
