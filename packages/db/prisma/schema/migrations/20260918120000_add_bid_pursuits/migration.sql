-- BidPursuit: a subcontractor's own pre-bid pipeline — projects being chased
-- before any GC has sent an invitation to bid.
--
-- ADDITIVE ONLY. One new enum, one new table, its indexes and three foreign
-- keys. Nothing existing is altered, nothing is dropped, nothing becomes NOT
-- NULL, no row is read or rewritten. Safe against a database with live data.
--
-- NO BACKFILL, DELIBERATELY. Nothing in the database records what a company
-- was chasing before an invitation arrived — that is the gap this closes —
-- so there is nothing to backfill FROM. In particular, NOT from SalesLead or
-- SalesOpportunity: those are Prova's own CRM for selling this product, on
-- the operator company only, and are not any tenant's pipeline.
--
-- Generated with `prisma migrate diff --from-schema-datamodel <main's
-- schema> --to-schema-datamodel prisma/schema --script` (no database
-- involved), then put on single lines by hand. Single lines because
-- scratch-cleanup-order.test.ts counts "FOREIGN KEY" occurrences against
-- what its pattern parses, and a wrapped constraint is the exact shape that
-- silently shrank that set once before.
--
-- NO CLEANUP-SCRIPT EDITS ARE NEEDED, and here is why rather than a shrug:
-- none of the three foreign keys can block a Job or Contact delete. The
-- table has no jobId and no contactId at all; bidInvitationId is SET NULL,
-- so the cleanup scripts' bidInvitation.deleteMany simply unlinks a pursuit;
-- createdByUserId is SET NULL. companyId is RESTRICT, like every other
-- company-scoped table, and neither script deletes a Company.

-- CreateEnum
CREATE TYPE "BidPursuitStage" AS ENUM ('WATCHING', 'CONTACTED', 'EXPECTING_INVITE', 'INVITED', 'DROPPED');

-- CreateTable
CREATE TABLE "BidPursuit" ("id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectName" TEXT NOT NULL, "owner" TEXT, "architect" TEXT, "expectedGcs" TEXT, "expectedBidDate" TIMESTAMP(3), "estimatedValue" DECIMAL(12,2), "stage" "BidPursuitStage" NOT NULL DEFAULT 'WATCHING', "bidInvitationId" TEXT, "note" TEXT, "createdByUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "BidPursuit_pkey" PRIMARY KEY ("id"));

-- CreateIndex
-- One invitation came from one pursuit. Postgres treats NULLs as distinct in
-- a unique index, so any number of not-yet-invited pursuits coexist.
CREATE UNIQUE INDEX "BidPursuit_bidInvitationId_key" ON "BidPursuit"("bidInvitationId");

-- CreateIndex
CREATE INDEX "BidPursuit_companyId_idx" ON "BidPursuit"("companyId");

-- CreateIndex
CREATE INDEX "BidPursuit_companyId_stage_idx" ON "BidPursuit"("companyId", "stage");

-- AddForeignKey
ALTER TABLE "BidPursuit" ADD CONSTRAINT "BidPursuit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL: deleting a mis-logged invitation must not take the pursuit's
-- history with it. The pursuit keeps its stage; only the link goes.
ALTER TABLE "BidPursuit" ADD CONSTRAINT "BidPursuit_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidPursuit" ADD CONSTRAINT "BidPursuit_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
