-- A count is a number of things, not a length, so it needs no scale.
-- Every other kind still does, and the CHECK is what keeps that guard structural.
ALTER TABLE "TakeoffMeasurement" ALTER COLUMN "calibrationId" DROP NOT NULL;
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_scale_unless_count"
  CHECK ("calibrationId" IS NOT NULL OR "kind" = 'COUNT');
