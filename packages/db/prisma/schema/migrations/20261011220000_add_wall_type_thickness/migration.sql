-- Finish-to-finish thickness on a wall type, so a wall measured off a drawing
-- can be matched to the assembly that prices it.
--
-- ADDITIVE AND NULLABLE. Every existing row keeps a NULL, which the matcher
-- reads as "this type cannot be matched by thickness" — the honest state for a
-- type somebody typed in without ever being asked for one. Nothing is
-- backfilled by inference: a guessed thickness would price walls.
ALTER TABLE "WallType" ADD COLUMN "thicknessIn" DECIMAL(6,2);
