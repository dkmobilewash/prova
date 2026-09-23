-- Forward-an-email intake: each company gets an unguessable inbound address
-- token, and an intake row can say it arrived by email.
--
-- Additive only. No foreign key is added (the token lives ON Company, and
-- the provenance columns live ON DocumentIntake), so the cleanup scripts'
-- delete order and the FK census in scratch-cleanup-order.test.ts are
-- untouched.

ALTER TABLE "Company" ADD COLUMN "intakeEmailToken" TEXT;

CREATE UNIQUE INDEX "Company_intakeEmailToken_key" ON "Company"("intakeEmailToken");

ALTER TABLE "DocumentIntake" ADD COLUMN "emailFrom" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN "emailSubject" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN "emailMessageId" TEXT;

CREATE INDEX "DocumentIntake_companyId_emailMessageId_idx" ON "DocumentIntake"("companyId", "emailMessageId");

-- Backfill: every existing company gets a token now, so the address shows
-- on /intake without waiting for a lazy write. gen_random_uuid() is
-- built-in from Postgres 13; one v4 UUID stripped of hyphens is 32 hex
-- chars / 122 random bits, the same shape the app issues with
-- crypto.randomBytes. A company created after this migration starts null
-- and /intake fills it on first open.
UPDATE "Company"
SET "intakeEmailToken" = lower(replace(gen_random_uuid()::text, '-', ''))
WHERE "intakeEmailToken" IS NULL;
