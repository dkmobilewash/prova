-- "Doors and windows from the plan": reads the door-swing and window symbols
-- off a floor plan, counts and measures them and places them on their wall
-- runs. Behind a per-company switch that is OFF.
--
-- ADDITIVE ONLY: one boolean with a default.
ALTER TABLE "Company" ADD COLUMN     "doorsWindowsOn" BOOLEAN NOT NULL DEFAULT false;
