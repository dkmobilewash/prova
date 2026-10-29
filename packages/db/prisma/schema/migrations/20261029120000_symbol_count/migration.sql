-- "Find all like this": box one symbol on a sheet and count every match by its
-- vector shape, saved as a Count item. Behind a per-company switch that is OFF.
--
-- ADDITIVE ONLY: one boolean with a default.
ALTER TABLE "Company" ADD COLUMN     "symbolCountOn" BOOLEAN NOT NULL DEFAULT false;
