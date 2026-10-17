-- ─────────────────────────────────────────────────────────────────────────
-- DETECTION PROPOSES INTO TAKEOFF ITEMS
-- ─────────────────────────────────────────────────────────────────────────
--
-- One nullable column, its index, and a foreign key. Additive; nothing is
-- dropped and the running build is unaffected until the deploy that reads it.
--
-- NO BACKFILL, and that is deliberate rather than an omission. A wall
-- proposal is INVALIDATED by a recalibration — `workspaceLoad.ts` reads only
-- the proposals under a sheet's CURRENT calibration — and the matching rules
-- that would fill this column (`lib/takeoff/proposalMatch.ts`) need the job's
-- items, which most jobs with old proposals do not have. So every existing
-- proposal keeps a null, shows as "Unassigned walls", and the next detection
-- run fills it properly. Guessing a match for a group nobody is looking at
-- would be inventing an assignment into a priced condition.

-- AlterTable
ALTER TABLE "TakeoffWallProposal" ADD COLUMN     "itemId" TEXT;

-- CreateIndex
CREATE INDEX "TakeoffWallProposal_itemId_idx" ON "TakeoffWallProposal"("itemId");

-- AddForeignKey
ALTER TABLE "TakeoffWallProposal" ADD CONSTRAINT "TakeoffWallProposal_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "TakeoffItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
