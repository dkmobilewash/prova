-- The two templates learn what kind of cost they are.
--
-- `JobLineItem.costCategory` is what the bid recap marks up by, and an
-- uncategorised line is deliberately marked up at NOTHING — the alternative is
-- a bid growing a number nobody chose. But none of the four automated
-- line-creating paths set it and none of the templates carried one to pass
-- through, so every line the product generated landed uncoded: the more of the
-- automation you used, the less of your bid got marked up.
--
-- ADDITIVE, NULLABLE, AND NO BACKFILL. The backfill that suggests itself is to
-- read the description — "board" and "stud" are material, "hang" and "finish"
-- are labor — and that is exactly the guess these columns exist to replace. It
-- would also be wrong in the direction nobody checks: a mis-inferred MATERIAL
-- on a labor line applies the material markup rate to labor, silently, on a
-- number a bid is made from.
--
-- So an entry nobody has coded reads as uncoded, the recap says so on screen,
-- and an estimator codes it once per catalog entry rather than once per bid.
--
-- Nothing is dropped and nothing is rewritten, so the running build cannot trip
-- over this: it simply does not select these columns yet.
-- AlterTable
ALTER TABLE "LineItemCatalogEntry" ADD COLUMN     "costCategory" "CostCategory";

-- AlterTable
ALTER TABLE "WallTypeComponent" ADD COLUMN     "costCategory" "CostCategory";
