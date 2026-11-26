-- Plan-delete Undo (Diego, 2026-11-26; coordination/plan-delete-undo.md). Additive and nullable only; no backfill.
-- A deleted plan leaves its job for the 10-minute undo window (jobId NULL, the original kept in deleteUndo), and the
-- purge hard-deletes it after the window.
ALTER TABLE "TakeoffPlan" ALTER COLUMN "jobId" DROP NOT NULL;
ALTER TABLE "TakeoffPlan" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "TakeoffPlan" ADD COLUMN "deletedByUserId" TEXT;
ALTER TABLE "TakeoffPlan" ADD COLUMN "deleteUndo" JSONB;
CREATE INDEX "TakeoffPlan_jobId_deletedAt_idx" ON "TakeoffPlan"("jobId", "deletedAt");
ALTER TABLE "TakeoffPlan" ADD CONSTRAINT "TakeoffPlan_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
