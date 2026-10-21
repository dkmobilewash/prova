-- "Find the rooms": a room is an AREA measurement drawn from the found walls,
-- named by the tag inside it, behind a per-company switch that is OFF.
--
-- ADDITIVE ONLY: one enum value, two nullable columns, one index, one boolean
-- with a default. Nothing the running build reads changes shape, so the gap
-- between this landing and the next deploy going live cannot break a request
-- (CLAUDE.md, the expand-then-contract entry).
--
-- The enum value is added first and used by nothing below: Postgres refuses a
-- new enum value USED in the same transaction it was added in.

ALTER TYPE "TakeoffMeasurementSource" ADD VALUE 'ROOM_FINDER';

-- What the drawing printed in the room tag. Null on every area that is not a
-- room. Perimeter is deliberately NOT a column: derived from the polygon.
ALTER TABLE "TakeoffMeasurement" ADD COLUMN     "roomName" TEXT,
ADD COLUMN     "roomNumber" TEXT;

CREATE INDEX "TakeoffMeasurement_pageId_roomNumber_idx" ON "TakeoffMeasurement"("pageId", "roomNumber");

-- Off until the owner turns it on. Not in CompanyAiSettings: no model runs.
ALTER TABLE "Company" ADD COLUMN     "roomFinderOn" BOOLEAN NOT NULL DEFAULT false;
