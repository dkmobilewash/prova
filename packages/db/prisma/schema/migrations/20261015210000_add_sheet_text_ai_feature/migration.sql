-- Reading the lettering off a SCANNED sheet, which has no text layer.
-- Additive only: a new member on an existing enum. Nothing reads or
-- writes it until a company turns the feature on, and the default for an
-- unset feature is unchanged.
ALTER TYPE "AiFeature" ADD VALUE 'SHEET_TEXT';
