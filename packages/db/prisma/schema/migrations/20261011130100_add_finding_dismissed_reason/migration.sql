-- AgentFinding.dismissedReason: why a finding was dismissed — HANDLED (plain
-- Dismiss) or WRONG ("Not right", fed back to the research pass).
--
-- ADDITIVE ONLY. One new enum and one nullable column with no default, so
-- every existing row reads NULL and the live build, which never selects the
-- column, is unaffected. Generated with a schema-to-schema
-- `prisma migrate diff` (no database connection).

-- CreateEnum
CREATE TYPE "FindingDismissal" AS ENUM ('HANDLED', 'WRONG');

-- AlterTable
ALTER TABLE "AgentFinding" ADD COLUMN     "dismissedReason" "FindingDismissal";
