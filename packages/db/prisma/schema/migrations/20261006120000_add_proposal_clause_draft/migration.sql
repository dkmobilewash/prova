-- The clauses a scope letter does not mention, drafted for somebody to accept.
--
-- PURELY ADDITIVE: one new enum TYPE, one new table, and no change to any
-- existing column. Nothing is dropped, nothing renamed, no existing row
-- touched, and no backfill is possible — a draft exists only once somebody
-- presses the button that pays for it.
--
-- SAFE IN THE OLD BUILD'S HANDS: a table and a type the deploy-gap build never
-- references are invisible to it. This is the easy direction of
-- expand-then-contract, and it is worth naming which direction it is: the fatal
-- one is REMOVING a value or a column the running code still reads, which is a
-- two-PR job.
--
-- `factRef` IS WHY THIS TABLE EXISTS, and it is the column to understand before
-- changing anything here. Coverage is DECLARED: a fact is answered when a draft
-- carrying its ref exists, not when some clause happens to contain the words
-- "Level 5". Text matching is what this repo refuses everywhere else
-- (`costCategory`, `craftClassificationId`, the takeoff recipes), and here it
-- fails in the direction that costs money — "Level 5 finish IS included" and
-- "Level 5 finish is NOT included" contain the same words, and a coverage check
-- built on words cannot tell those apart.
--
-- A fact with a draft in ANY status is never proposed again, which is why
-- DISMISSED is a recorded status rather than a deleted row. An estimator who
-- decided a requirement does not belong on this letter should not be asked
-- again next time somebody presses draft; without that, the panel is a nag.
--
-- TWO ROWS MAY SHARE ONE `factRef`, deliberately, so there is no unique
-- constraint on it. For a spec requirement the app CANNOT tell whether the bid
-- priced it — matching "Level 5 finish at public areas" to a line item means
-- reading line text for meaning — so the reader drafts an INCLUSION and an
-- EXCLUSION and the estimator picks the true one. A unique index here would
-- have made that pair unrepresentable.
--
-- `acceptedClauseId` IS A PLAIN COLUMN, NOT A FOREIGN KEY, and that is a
-- decision rather than an omission. A `JobProposalClause` is a SNAPSHOT —
-- `proposals.prisma` says so of the library and the same holds here — and it
-- can be deleted from the proposal page by somebody who changed their mind. A
-- cascade would then delete the draft and re-open a fact the estimator had
-- answered; a RESTRICT would refuse the deletion. Neither is right, so this
-- records which clause it became and tolerates that clause being gone.

-- CreateEnum
CREATE TYPE "ProposalDraftStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED');
-- CreateTable
CREATE TABLE "ProposalClauseDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "ProposalClauseKind" NOT NULL,
    "text" TEXT NOT NULL,
    "factKind" TEXT NOT NULL,
    "factRef" TEXT NOT NULL,
    "citation" TEXT,
    "status" "ProposalDraftStatus" NOT NULL DEFAULT 'PROPOSED',
    "acceptedClauseId" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProposalClauseDraft_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ProposalClauseDraft_companyId_idx" ON "ProposalClauseDraft"("companyId");
-- CreateIndex
CREATE INDEX "ProposalClauseDraft_jobId_status_idx" ON "ProposalClauseDraft"("jobId", "status");
-- CreateIndex
CREATE INDEX "ProposalClauseDraft_jobId_factRef_idx" ON "ProposalClauseDraft"("jobId", "factRef");
-- AddForeignKey
ALTER TABLE "ProposalClauseDraft" ADD CONSTRAINT "ProposalClauseDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProposalClauseDraft" ADD CONSTRAINT "ProposalClauseDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProposalClauseDraft" ADD CONSTRAINT "ProposalClauseDraft_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
