-- Near misses on the safety log WITHOUT an OSHA case number.
--
-- Until now every incident took a number from SafetyCaseCounter, so logging
-- a near miss (nobody hurt) burned a case number and left a gap in the 300
-- log's sequence that nothing on the log explains.
--
-- ADDITIVE-SAFE, and the second statement deserves the word "safe" spelled
-- out: DROP NOT NULL only RELAXES a constraint. Every existing row keeps its
-- number, nothing is rewritten, and the build live while this applies keeps
-- reading `caseNumber` as an Int, because no NULL can exist until the new
-- build writes the first near miss. (preflight's destructive-statement check
-- matches DROP TABLE/COLUMN, not this.) Generated with a schema-to-schema
-- `prisma migrate diff` (no database connection); the CHECK is hand-added.

-- AlterEnum
ALTER TYPE "IncidentOutcome" ADD VALUE 'NEAR_MISS';

-- AlterTable
ALTER TABLE "SafetyIncident" ALTER COLUMN "caseNumber" DROP NOT NULL;

-- A case number is missing EXACTLY when the row is a near miss. Every
-- existing row has a number and none is a near miss, so it validates.
--
-- `"outcome"::text`, not a bare enum comparison, on purpose: Postgres
-- refuses to USE an enum value added in the same transaction ("unsafe use
-- of new enum value"), and comparing as text never casts 'NEAR_MISS' to the
-- enum.
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_near_miss_has_no_case_number" CHECK (("outcome"::text = 'NEAR_MISS') = ("caseNumber" IS NULL));
