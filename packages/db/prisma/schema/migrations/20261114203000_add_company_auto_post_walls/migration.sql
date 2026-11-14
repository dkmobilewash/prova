-- "Auto-post walls": walls post themselves only where an owner turned this on. Every company,
-- existing and new, starts false (Diego, 2026-11-14); doors keep "autoPostOn" exactly as before.
ALTER TABLE "Company" ADD COLUMN "autoPostWalls" BOOLEAN NOT NULL DEFAULT false;
