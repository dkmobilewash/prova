-- Takeoff summary export (CSV + PDF, quantities only), behind a per-company
-- switch that is OFF. ADDITIVE ONLY: one boolean with a default.

ALTER TABLE "Company" ADD COLUMN "takeoffExportOn" BOOLEAN NOT NULL DEFAULT false;
