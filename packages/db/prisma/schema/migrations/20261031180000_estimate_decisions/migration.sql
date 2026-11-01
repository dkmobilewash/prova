-- The default partition, wall openings and a sheet's finish lines. All additive.
ALTER TABLE "WallType" ADD COLUMN "isDefaultPartition" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TakeoffMeasurement" ADD COLUMN "openings" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "TakeoffPlanPage" ADD COLUMN "finishTakeoff" JSONB;
