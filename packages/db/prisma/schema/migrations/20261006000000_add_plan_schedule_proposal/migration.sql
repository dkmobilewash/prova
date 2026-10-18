-- Reading a door, window, finish or partition schedule off a drawing.
--
-- PURELY ADDITIVE: one new enum VALUE on `PlanIngestStage`, one new table, and
-- no change to any existing column. Nothing is dropped, nothing is renamed, no
-- existing row is touched, and no backfill is possible — a schedule reading only
-- exists once somebody presses the button that pays for it.
--
-- SAFE IN THE OLD BUILD'S HANDS, both halves. A table the deploy-gap build never
-- selects is invisible to it. The enum VALUE is the half worth saying out loud:
-- `migrate.yml` applies this on merge while Vercel is still building the commit
-- that knows `SCHEDULE_ROWS`, so for a minute or two the live build reads a
-- column whose type has gained a member it has never heard of. That direction is
-- safe — Postgres hands back a string the old Prisma client has no case for, and
-- nothing can be holding such a row yet because nothing has written one. The
-- opposite direction is the fatal one, and it is why CLAUDE.md's
-- expand-then-contract rule exists: REMOVING a value the running code still
-- reads is a two-PR job.
--
-- ADD VALUE AND CREATE TABLE IN ONE MIGRATION is fine here and is not fine in
-- general. Postgres 12+ allows `ALTER TYPE ... ADD VALUE` inside a transaction
-- provided the new value is not USED in that same transaction. The table below
-- uses `PlanSheetConfidence` and `PlanSheetProposalStatus`, both of which already
-- exist; `SCHEDULE_ROWS` is referenced by nothing here. Had the table carried a
-- column defaulting to the new value, this would have needed splitting.
--
-- `rows` IS JSONB, NOT A CHILD TABLE, and the reason is on the model: a row here
-- is a PROPOSAL, read and shown and then accepted or thrown away as a set.
-- Nothing joins to an individual row, nothing updates one in place. A child table
-- would buy referential integrity for rows that have no referents and cost a
-- cascade on every re-read. When a row becomes something the app ACTS on — a
-- door mark matched to a measurement — that is a real row in a real table, and it
-- is deliberately not in this change.
--
-- WHY THE TWO COUNTS ARE COLUMNS. `gridRowCount` and `readRowCount` are the pair
-- that tells a person whether to trust a reading: sixty lines of reconstructed
-- grid read as twelve rows either dropped a column of repeated headers or lost
-- half the schedule, and only somebody looking at the sheet can say which. They
-- are stored rather than derived because the grid is rebuilt from the PDF and
-- re-deriving it would mean re-opening the file to answer a question about a
-- reading that already happened.

-- AlterEnum
ALTER TYPE "PlanIngestStage" ADD VALUE 'SCHEDULE_ROWS';
-- CreateTable
CREATE TABLE "PlanScheduleProposal" (
    "id" TEXT NOT NULL,
    "ingestJobId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "rows" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" "PlanSheetConfidence" NOT NULL,
    "gridRowCount" INTEGER NOT NULL,
    "readRowCount" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "PlanSheetProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanScheduleProposal_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "PlanScheduleProposal_planId_pageNumber_createdAt_idx" ON "PlanScheduleProposal"("planId", "pageNumber", "createdAt");
-- CreateIndex
CREATE INDEX "PlanScheduleProposal_planId_status_idx" ON "PlanScheduleProposal"("planId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "PlanScheduleProposal_ingestJobId_pageNumber_key" ON "PlanScheduleProposal"("ingestJobId", "pageNumber");
-- AddForeignKey
ALTER TABLE "PlanScheduleProposal" ADD CONSTRAINT "PlanScheduleProposal_ingestJobId_fkey" FOREIGN KEY ("ingestJobId") REFERENCES "PlanIngestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PlanScheduleProposal" ADD CONSTRAINT "PlanScheduleProposal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PlanScheduleProposal" ADD CONSTRAINT "PlanScheduleProposal_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
