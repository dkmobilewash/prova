-- AlterEnum
--
-- "Erase walls in this area" (coordination/erase-area-tool.md; Diego approved this migration by name 2026-11-26).
-- ADDITIVE: one enum value. Safe for the running build, since no row carries it until the new build writes one.
ALTER TYPE "TakeoffExclusionKind" ADD VALUE 'ERASE_AREA';
