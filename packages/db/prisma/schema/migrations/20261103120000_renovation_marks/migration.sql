-- The words on a sheet that mark it as renovation work. Additive.
ALTER TABLE "PlanSheetText" ADD COLUMN "renovationMarks" TEXT[] DEFAULT ARRAY[]::TEXT[];
