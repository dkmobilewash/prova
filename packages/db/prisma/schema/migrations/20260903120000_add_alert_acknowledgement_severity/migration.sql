-- Purely additive: a new type and a NULLABLE column. Nothing is dropped,
-- nothing is backfilled, and every existing AlertAcknowledgement row keeps
-- its NULL — which apps/web/lib/alerts.ts reads as DUE_SOON on purpose.
--
-- Deliberately NOT here: any change to AlertAcknowledgement.alertKey or to
-- NotificationDispatch.dispatchKey. Rewriting the key's shape would orphan
-- every dispatch row already recorded, so sentKeysFor() would match nothing
-- and the next run would re-send every notice — the nag the feature exists
-- to prevent. Issue #110.

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('OVERDUE', 'DUE_SOON', 'STANDING');

-- AlterTable
ALTER TABLE "AlertAcknowledgement" ADD COLUMN "acknowledgedSeverity" "AlertSeverity";
