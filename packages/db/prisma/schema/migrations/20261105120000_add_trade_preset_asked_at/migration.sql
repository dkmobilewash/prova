-- Guided flow Phase 5: when a company was asked its trade at signup.
-- Additive and nullable: every existing company stays NULL, which is what
-- keeps the markup banner and stepper rule off them.
ALTER TABLE "Company" ADD COLUMN "tradePresetAskedAt" TIMESTAMP(3);
