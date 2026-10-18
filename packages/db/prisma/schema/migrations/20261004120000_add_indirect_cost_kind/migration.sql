-- Indirect / general-conditions costs become recognisable.
--
-- PURELY ADDITIVE: one enum, two NULLABLE columns, no backfill and no default.
-- Every existing row keeps a null, which reads as "an ordinary line" — which is
-- what every line that exists today is. Nothing moves.
--
-- WHY A SECOND AXIS RATHER THAN A SIXTH CostCategory: indirect-ness and markup
-- treatment are different questions, and growing CostCategory would have forced
-- a new markup rate column (RECAP_RATE_FIELDS is a total Record over it),
-- touched the QuickBooks account mapping, and split history permanently the way
-- EQUIPMENT did on 2026-09-26.
--
-- Generated with `prisma migrate diff --from-schema-datamodel
-- --to-schema-datamodel`, which opens no database connection. NEVER with
-- `--shadow-database-url`, which drops and recreates whatever it is handed and
-- cost `ep-icy-hat` on 2026-09-18.

-- CreateEnum
CREATE TYPE "IndirectCostKind" AS ENUM ('SUPERVISION', 'MOBILIZATION', 'PERMITS', 'CLEANUP', 'SAFETY', 'TEMPORARY_PROTECTION', 'DUMPSTERS', 'CLOSEOUT');

-- AlterTable
ALTER TABLE "LineItemCatalogEntry" ADD COLUMN     "indirectKind" "IndirectCostKind";

-- AlterTable
ALTER TABLE "JobLineItem" ADD COLUMN     "indirectKind" "IndirectCostKind";
