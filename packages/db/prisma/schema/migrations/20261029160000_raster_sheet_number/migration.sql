-- AlterTable: the sheet number OCR read off a scanned sheet's title-block corner. Additive, nullable.
ALTER TABLE "PlanSheetRaster" ADD COLUMN "sheetNumber" TEXT;
