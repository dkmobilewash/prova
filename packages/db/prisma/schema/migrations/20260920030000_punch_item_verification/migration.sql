-- CreateEnum
CREATE TYPE "PunchItemStatus" AS ENUM ('OPEN', 'READY_FOR_REVIEW', 'VERIFIED');
-- AlterTable
ALTER TABLE "PunchListItem" ADD COLUMN     "area" TEXT,
ADD COLUMN     "assignedCrewMemberId" TEXT,
ADD COLUMN     "assignedName" TEXT,
ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "backchargeId" TEXT,
ADD COLUMN     "causedByOthers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueOn" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "readyByUserId" TEXT,
ADD COLUMN     "reopenReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenedByUserId" TEXT,
ADD COLUMN     "responsibleParty" "DelayResponsibleParty",
ADD COLUMN     "status" "PunchItemStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" TEXT;
-- CreateIndex
CREATE INDEX "PunchListItem_jobId_status_idx" ON "PunchListItem"("jobId", "status");
-- CreateIndex
CREATE INDEX "PunchListItem_assignedUserId_idx" ON "PunchListItem"("assignedUserId");
-- CreateIndex
CREATE INDEX "PunchListItem_assignedCrewMemberId_idx" ON "PunchListItem"("assignedCrewMemberId");
-- CreateIndex
CREATE INDEX "PunchListItem_backchargeId_idx" ON "PunchListItem"("backchargeId");
-- AddForeignKey
ALTER TABLE "PunchListItem" ADD CONSTRAINT "PunchListItem_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PunchListItem" ADD CONSTRAINT "PunchListItem_assignedCrewMemberId_fkey" FOREIGN KEY ("assignedCrewMemberId") REFERENCES "CrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PunchListItem" ADD CONSTRAINT "PunchListItem_readyByUserId_fkey" FOREIGN KEY ("readyByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PunchListItem" ADD CONSTRAINT "PunchListItem_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PunchListItem" ADD CONSTRAINT "PunchListItem_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PunchListItem" ADD CONSTRAINT "PunchListItem_backchargeId_fkey" FOREIGN KEY ("backchargeId") REFERENCES "Backcharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Everything above is Prisma's own additive diff. Everything below is
-- hand-written, and says what the columns above are allowed to mean.

-- An item that was ticked off before this migration was the CREW saying it
-- was fixed — that is all the old checkbox ever meant, and nobody verified
-- it. So it lands on READY_FOR_REVIEW rather than VERIFIED: calling it
-- verified here would invent a witness for every item in the database.
UPDATE "PunchListItem"
SET "status" = 'READY_FOR_REVIEW',
    "readyAt" = COALESCE("completedAt", "updatedAt")
WHERE "isDone" = true;

-- At most one kind of assignee. Three nullable columns with no constraint
-- is three different answers to "who is fixing this" waiting to disagree.
ALTER TABLE "PunchListItem"
  ADD CONSTRAINT "PunchListItem_one_assignee"
  CHECK (num_nonnulls("assignedUserId", "assignedCrewMemberId", "assignedName") <= 1);

-- A typed name is a name. An empty string is a form that was submitted
-- with the field untouched, and it would read on screen as "assigned to
-- nobody in particular" rather than as unassigned.
ALTER TABLE "PunchListItem"
  ADD CONSTRAINT "PunchListItem_assigned_name_not_blank"
  CHECK ("assignedName" IS NULL OR length(btrim("assignedName")) > 0);

-- A status with no witness is the thing this split exists to prevent, so
-- the database refuses one rather than trusting every writer to remember.
ALTER TABLE "PunchListItem"
  ADD CONSTRAINT "PunchListItem_ready_has_time"
  CHECK ("status" <> 'READY_FOR_REVIEW' OR "readyAt" IS NOT NULL);

ALTER TABLE "PunchListItem"
  ADD CONSTRAINT "PunchListItem_verified_has_witness"
  CHECK ("status" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL);

-- `isDone` and `completedAt` are derived from `status`. CLAUDE.md's rule is
-- that derived state is never stored, and the honest version of this change
-- drops both columns — but closeout readiness, the export, the Ask commands
-- and the phone all read `isDone`, and a destructive migration against real
-- data to save two columns is not a trade worth making unannounced.
--
-- This trigger buys the property the rule is actually about: nothing
-- app-side decides them, so they cannot drift from `status`. It OVERWRITES
-- whatever a writer supplies, deliberately — a writer that still sets
-- isDone by hand is not an error to raise, it is a caller that predates the
-- column having an owner.
CREATE OR REPLACE FUNCTION prova_punch_item_status_sync() RETURNS trigger AS $$
BEGIN
  NEW."isDone" := NEW."status" <> 'OPEN';
  IF NEW."status" = 'OPEN' THEN
    NEW."completedAt" := NULL;
  ELSE
    -- When the work was finished, not when somebody got round to agreeing:
    -- readyAt first, and verifiedAt only for an item verified outright.
    NEW."completedAt" := COALESCE(NEW."readyAt", NEW."verifiedAt", NEW."completedAt", now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prova_punch_item_status_sync ON "PunchListItem";
CREATE TRIGGER prova_punch_item_status_sync
  BEFORE INSERT OR UPDATE ON "PunchListItem"
  FOR EACH ROW EXECUTE FUNCTION prova_punch_item_status_sync();
