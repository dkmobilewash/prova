-- The ceiling over a room found by the room finder: type family, the
-- drawing's code, height, where it was read from, and whether it is a guess.
--
-- ADDITIVE ONLY: five nullable-or-defaulted columns on TakeoffMeasurement.
-- Nothing the running build reads changes shape (CLAUDE.md, expand then
-- contract). Applied so far only to the e2e runner's throwaway Postgres.
ALTER TABLE "TakeoffMeasurement" ADD COLUMN     "ceilingFamily" TEXT,
ADD COLUMN     "ceilingCode" TEXT,
ADD COLUMN     "ceilingHeightFeet" DOUBLE PRECISION,
ADD COLUMN     "ceilingFrom" TEXT,
ADD COLUMN     "ceilingGuess" BOOLEAN NOT NULL DEFAULT false;
