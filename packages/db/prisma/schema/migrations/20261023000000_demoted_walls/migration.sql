-- "Demote, don't hide": runs the wall check labels as casework or reference
-- stay visible on the takeoff, greyed and out of the total, instead of being
-- dropped with no way back but a re-find. Behind a per-company switch that
-- is OFF.
--
-- ADDITIVE ONLY: one boolean with a default. Nothing the running build reads
-- changes shape (CLAUDE.md, the expand-then-contract entry).
ALTER TABLE "Company" ADD COLUMN     "demotedWallsOn" BOOLEAN NOT NULL DEFAULT false;
