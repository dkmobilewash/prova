-- A punch item has ONE location on a drawing.
--
-- Pinning an item that is already pinned moves it; this index is what makes
-- that true under concurrency, rather than the read in createSheetPin, which
-- two simultaneous submits can both pass.
--
-- SAFE TO APPLY WITH NO DEDUPE, and that is derived rather than assumed: a
-- PUNCH pin is refused by pinContentProblem unless it carries a punchItemId,
-- and the only caller (SheetPinViewer) has never sent one -- the button has
-- always failed. So no punch pin exists to collide. Photo and note pins hold
-- NULL here, and Postgres treats NULLs as distinct, so they are untouched.
--
-- The plain index on punchItemId is dropped because a unique index serves the
-- same lookups.
DROP INDEX IF EXISTS "SheetPin_punchItemId_idx";
CREATE UNIQUE INDEX "SheetPin_punchItemId_key" ON "SheetPin"("punchItemId");
