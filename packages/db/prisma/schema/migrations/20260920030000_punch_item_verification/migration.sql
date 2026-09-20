-- Gap 4: a punch item stops being a checkbox.
--
-- ORDER IS LOAD-BEARING IN THIS FILE. Prisma's own diff put the two DROPs
-- in the same statement as the ADDs, and ahead of them — which would have
-- thrown `isDone` away before the backfill below could read it, silently
-- reopening every closed punch item in the database. The halves are
-- separated by hand: add, backfill from the old columns, constrain, and
-- only then drop.

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

-- An item that was ticked off before this migration was the CREW saying it
-- was fixed — that is all the old checkbox ever meant, and nobody verified
-- it. So it lands on READY_FOR_REVIEW rather than VERIFIED: calling it
-- verified here would invent a witness for every item in the database.
--
-- This reads `isDone` and `completedAt`, which is why it runs before the
-- drops at the foot of this file.
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

-- A status with no witness is the thing the Ready/Verified split exists to
-- prevent, so the database refuses one rather than trusting every writer to
-- remember. These also make the two dropped columns unnecessary: when the
-- work was finished is `readyAt`, and it cannot disagree with the status.
ALTER TABLE "PunchListItem"
  ADD CONSTRAINT "PunchListItem_ready_has_time"
  CHECK ("status" <> 'READY_FOR_REVIEW' OR "readyAt" IS NOT NULL);

ALTER TABLE "PunchListItem"
  ADD CONSTRAINT "PunchListItem_verified_has_witness"
  CHECK ("status" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL);

-- THE DESTRUCTIVE PART, LAST AND ON PURPOSE.
--
-- `isDone` and `completedAt` were a stored derivation of the state above:
-- `isDone` was `status <> 'OPEN'` and `completedAt` was `readyAt` under
-- another name. CLAUDE.md's oldest rule is that derived state is never
-- stored, because a stored flag can disagree with what it was derived
-- from, and this pair could: nothing stopped a writer setting isDone
-- without touching anything else.
--
-- The first version of this migration kept both columns and added a
-- trigger to hold them in lockstep. That was the cautious answer, not the
-- honest one — it left two columns whose only job was to agree with a
-- third, and every future reader still had to be told which one to trust.
-- Diego's call, 2026-09-20, announced in #prova-build before the push.
--
-- Nothing is lost that the row does not still hold: the backfill above
-- moved every closed item's completion time into `readyAt` first.
ALTER TABLE "PunchListItem" DROP COLUMN "isDone";
ALTER TABLE "PunchListItem" DROP COLUMN "completedAt";
