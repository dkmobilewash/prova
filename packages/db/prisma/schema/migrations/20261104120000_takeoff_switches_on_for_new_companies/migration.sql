-- New companies get whole-set walls, rooms, and doors/windows ON (Diego, 2026-11-04).
-- Only the column DEFAULT changes: no existing company row is updated.
ALTER TABLE "Company" ALTER COLUMN "roomFinderOn" SET DEFAULT true;
ALTER TABLE "Company" ALTER COLUMN "wholeSetTakeoffOn" SET DEFAULT true;
ALTER TABLE "Company" ALTER COLUMN "doorsWindowsOn" SET DEFAULT true;
