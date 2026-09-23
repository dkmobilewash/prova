-- Determination standing, phase 1 (no AI): the entered facts a "is this
-- prevailing-wage determination still in force" line is derived from.
--
-- ADDITIVE. Four nullable columns on Job (entered public-works facts), four
-- nullable columns on PrevailingWageDetermination (what the document says
-- about itself) and one enum. No existing row is read or rewritten; every
-- existing determination has none of these and is reported as "unchecked".
-- Nothing here is a wage rate.
--
-- Generated with `prisma migrate diff --from-schema-datamodel <origin/main>
-- --to-schema-datamodel prisma/schema` — a schema-to-schema diff that opens
-- no database connection (CLAUDE.md, `--shadow-database-url`).

-- CreateEnum
CREATE TYPE "DeterminationExpirationMarker" AS ENUM ('NONE', 'SINGLE', 'DOUBLE');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "awardingBody" TEXT,
ADD COLUMN     "bidAdvertisedOn" TIMESTAMP(3),
ADD COLUMN     "publicWorks" BOOLEAN,
ADD COLUMN     "siteCounty" TEXT;

-- AlterTable
ALTER TABLE "PrevailingWageDetermination" ADD COLUMN     "determinationRef" TEXT,
ADD COLUMN     "expirationMarker" "DeterminationExpirationMarker",
ADD COLUMN     "expiresOn" TIMESTAMP(3),
ADD COLUMN     "issuedOn" TIMESTAMP(3);
